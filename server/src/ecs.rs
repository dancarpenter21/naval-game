use serde::Deserialize;
use serde_yaml::Value as YamlValue;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

#[derive(Debug, Clone, Deserialize)]
pub struct ComponentConfig {
    pub kind: String,
    #[serde(default)]
    pub data: YamlValue,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EntityConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub components: Vec<ComponentConfig>,
}

/// Static template set describing the entities/components available to a game.
#[derive(Debug, Clone)]
pub struct WorldTemplate {
    pub entities: Vec<EntityConfig>,
}

impl WorldTemplate {
    /// Load all entity definitions from a directory.
    ///
    /// Files with `.yaml` / `.yml` extension are read. Each file may
    /// contain either a single `EntityConfig` object or an array of them.
    pub fn load_from_dir<P: AsRef<Path>>(dir: P) -> Result<Self, Box<dyn Error>> {
        let dir = dir.as_ref();
        let mut entities = Vec::new();

        if !dir.exists() {
            warn!("WorldTemplate directory {:?} does not exist; no entities loaded", dir);
            return Ok(WorldTemplate { entities });
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if !is_entity_file(&path) {
                continue;
            }

            let content = fs::read_to_string(&path)?;
            match try_parse_entities(&content) {
                Ok(mut file_entities) => {
                    info!(
                        "Loaded {} entity definition(s) from {:?}",
                        file_entities.len(),
                        path
                    );
                    entities.append(&mut file_entities);
                }
                Err(e) => {
                    warn!("Failed to parse entity file {:?}: {}", path, e);
                }
            }
        }

        Ok(WorldTemplate { entities })
    }
}

fn is_entity_file(path: &PathBuf) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(ext, "yaml" | "yml"),
        None => false,
    }
}

fn try_parse_entities(content: &str) -> Result<Vec<EntityConfig>, Box<dyn Error>> {
    // Try array-of-entities first.
    if let Ok(list) = serde_yaml::from_str::<Vec<EntityConfig>>(content) {
        return Ok(list);
    }

    // Fallback: single entity object.
    let single = serde_yaml::from_str::<EntityConfig>(content)?;
    Ok(vec![single])
}

