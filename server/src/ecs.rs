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

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to get the absolute path to the default entities directory
    /// used by the server: `<crate root>/config/entities`.
    fn entities_dir() -> PathBuf {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        Path::new(manifest_dir).join("config").join("entities")
    }

    #[test]
    fn loads_all_entities_from_config_directory() {
        let dir = entities_dir();
        let template = WorldTemplate::load_from_dir(&dir)
            .unwrap_or_else(|e| panic!("failed to load entities from {:?}: {e}", dir));

        // We expect at least one entity definition to be present in the config.
        assert!(
            !template.entities.is_empty(),
            "expected at least one entity in {:?}, found none",
            dir
        );

        // Basic sanity check: every loaded entity should have a non-empty id and name.
        for entity in &template.entities {
            assert!(
                !entity.id.trim().is_empty(),
                "entity has empty id: {:?}",
                entity
            );
            assert!(
                !entity.name.trim().is_empty(),
                "entity has empty name: {:?}",
                entity
            );
        }
    }

    #[test]
    fn example_ship_components_are_loaded_correctly() {
        let dir = entities_dir();
        let template = WorldTemplate::load_from_dir(&dir)
            .unwrap_or_else(|e| panic!("failed to load entities from {:?}: {e}", dir));

        // Find the frigate defined in `example-ship.yaml`.
        let frigate = template
            .entities
            .iter()
            .find(|e| e.id == "frigate")
            .expect("expected an entity with id 'frigate'");

        // We expect two components: transform and movement.
        assert_eq!(
            frigate.components.len(),
            2,
            "frigate should have exactly two components"
        );

        let mut kinds: Vec<&str> = frigate.components.iter().map(|c| c.kind.as_str()).collect();
        kinds.sort_unstable();

        assert_eq!(kinds, vec!["movement", "transform"]);

        // Ensure that component data objects were deserialized and are not empty.
        for component in &frigate.components {
            assert!(
                !component.data.is_null(),
                "component '{}' has null data",
                component.kind
            );
        }
    }
}

