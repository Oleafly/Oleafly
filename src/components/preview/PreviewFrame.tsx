const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

export function PreviewFrame({ src, title }: Readonly<{ src: string; title: string }>) {
  return (
    <iframe
      title={title}
      src={src}
      sandbox={FRAME_SANDBOX}
      allow="fullscreen"
      className="size-full border-0 bg-white"
    />
  );
}
