use super::EnvironmentBlocks;

const MACHINE_ENVIRONMENT: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
const USER_ENVIRONMENT: &str = "Environment";
const VALUE_LIMIT: usize = 512;

pub(super) fn read_environment() -> EnvironmentBlocks {
    EnvironmentBlocks {
        machine: read_values(windows_registry::LOCAL_MACHINE, MACHINE_ENVIRONMENT),
        user: read_values(windows_registry::CURRENT_USER, USER_ENVIRONMENT),
    }
}

fn read_values(root: &windows_registry::Key, path: &str) -> Vec<(String, String)> {
    let Ok(key) = root.open(path) else {
        return Vec::new();
    };
    let Ok(values) = key.values() else {
        return Vec::new();
    };
    values
        .take(VALUE_LIMIT)
        .filter_map(|(name, value)| String::try_from(value).ok().map(|text| (name, text)))
        .collect()
}
