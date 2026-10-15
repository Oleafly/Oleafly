mod people;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use oleafly_server::blobs::sha256_hex;
use oleafly_server::config::BlobStoreConfig;
use oleafly_server::test_support::{test_config, MockS3};
use people::{put_bytes, share_project, stage_with};
use reqwest::StatusCode;
use ring::digest::{Context, SHA256};

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

const MIB: usize = 1024 * 1024;
const FILE: usize = 24 * MIB;

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[tokio::test]
async fn a_large_file_is_sent_from_disk_and_from_a_bucket_in_pieces() {
    for bucket in [None, Some(MockS3::start().await)] {
        let data = tempfile::tempdir().expect("data folder");
        let mut config = test_config();
        config.data_dir = data.path().to_path_buf();
        if let Some(bucket) = &bucket {
            config.blob_store = BlobStoreConfig::S3(Box::new(bucket.config("oleafly")));
        }
        let stage = stage_with(config).await;
        let project = share_project(&stage.server, &stage.bob, "Thesis")
            .await
            .project_id;
        let content: Vec<u8> = (0..FILE).map(|index| (index % 251) as u8).collect();
        let hash = sha256_hex(&content);
        let path = format!("/api/v1/projects/{project}/blobs/{hash}");
        let uploaded = put_bytes(&stage.server, &path, stage.bob.token(), content).await;
        assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
        stage.server.state().transfers.set_budget(4 * MIB as u64);

        let before = LIVE.load(Ordering::SeqCst);
        PEAK.store(before, Ordering::SeqCst);
        let mut response = reqwest::Client::new()
            .get(format!("{}{path}", stage.server.url()))
            .bearer_auth(stage.bob.token())
            .send()
            .await
            .expect("download");
        assert_eq!(response.status(), StatusCode::OK);
        let mut received = 0;
        let mut check = Context::new(&SHA256);
        while let Some(piece) = response.chunk().await.expect("a piece") {
            received += piece.len();
            check.update(&piece);
        }
        let rise = PEAK.load(Ordering::SeqCst).saturating_sub(before);
        assert_eq!(received, FILE);
        assert_eq!(hex(check.finish().as_ref()), hash);
        assert!(
            rise < 8 * MIB,
            "sending a {} MiB file raised the heap by {} KiB (bucket: {})",
            FILE / MIB,
            rise / 1024,
            bucket.is_some()
        );
    }
}
