use std::path::Path;

pub(crate) const FOLDER_KEY: &str = r"Software\Classes\Directory\shell\Oleafly";
pub(crate) const BACKGROUND_KEY: &str = r"Software\Classes\Directory\Background\shell\Oleafly";
pub(crate) const VERB_KEYS: [&str; 2] = [FOLDER_KEY, BACKGROUND_KEY];
const COMMAND: &str = "command";
const ICON: &str = "Icon";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RegistryValue {
    pub(crate) key: String,
    pub(crate) name: &'static str,
    pub(crate) data: String,
}

#[cfg(windows)]
impl RegistryValue {
    fn labels_the_verb(&self) -> bool {
        self.name.is_empty() && !self.key.ends_with(COMMAND)
    }
}

pub(crate) fn exe_text(exe: &Path) -> Option<String> {
    crate::project_availability::without_verbatim_prefix(exe)
        .to_str()
        .map(str::to_string)
}

pub(crate) fn verb_values(exe: &str, label: &str) -> Vec<RegistryValue> {
    VERB_KEYS
        .iter()
        .flat_map(|key| {
            [
                RegistryValue {
                    key: (*key).to_string(),
                    name: "",
                    data: label.to_string(),
                },
                RegistryValue {
                    key: (*key).to_string(),
                    name: ICON,
                    data: format!("\"{exe}\",0"),
                },
                RegistryValue {
                    key: format!(r"{key}\{COMMAND}"),
                    name: "",
                    data: format!("\"{exe}\" {} \"%V\"", crate::open_request::OPEN_FOLDER_FLAG),
                },
            ]
        })
        .collect()
}

#[cfg(windows)]
fn under(prefix: &str, key: &str) -> String {
    if prefix.is_empty() {
        key.to_string()
    } else {
        format!(r"{prefix}\{key}")
    }
}

#[cfg(windows)]
fn read(root: &windows_registry::Key, prefix: &str, value: &RegistryValue) -> Option<String> {
    root.open(under(prefix, &value.key))
        .ok()?
        .get_string(value.name)
        .ok()
}

#[cfg(windows)]
pub(crate) fn state(
    root: &windows_registry::Key,
    prefix: &str,
    expected: &[RegistryValue],
) -> super::ItemState {
    let present = VERB_KEYS
        .iter()
        .any(|key| root.open(under(prefix, key)).is_ok());
    if !present {
        return super::ItemState::NotInstalled;
    }
    let current = expected
        .iter()
        .filter(|value| !value.labels_the_verb())
        .all(|value| read(root, prefix, value).as_deref() == Some(value.data.as_str()));
    if current {
        super::ItemState::Installed
    } else {
        super::ItemState::NeedsAttention
    }
}

#[cfg(windows)]
pub(crate) fn write(
    root: &windows_registry::Key,
    prefix: &str,
    expected: &[RegistryValue],
) -> Result<bool, String> {
    let mut changed = false;
    for value in expected {
        if read(root, prefix, value).as_deref() == Some(value.data.as_str()) {
            continue;
        }
        root.create(under(prefix, &value.key))
            .and_then(|key| key.set_string(value.name, &value.data))
            .map_err(|error| format!("{}: {error}", value.key))?;
        changed = true;
    }
    Ok(changed)
}

#[cfg(windows)]
pub(crate) fn remove(root: &windows_registry::Key, prefix: &str) -> Result<(), String> {
    for key in VERB_KEYS {
        let path = under(prefix, key);
        if root.open(&path).is_err() {
            continue;
        }
        root.remove_tree(&path)
            .map_err(|error| format!("{key}: {error}"))?;
    }
    Ok(())
}
