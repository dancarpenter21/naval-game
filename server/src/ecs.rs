use serde::{Deserialize, Serialize};
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
    pub allegiance: Allegiance,
    #[serde(default)]
    pub components: Vec<ComponentConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Allegiance {
    Hostile,
    Friendly,
}

impl Allegiance {
    #[allow(dead_code)] // For future serialization / API use
    pub fn as_str(&self) -> &'static str {
        match self {
            Allegiance::Hostile => "hostile",
            Allegiance::Friendly => "friendly",
        }
    }
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

        load_from_dir_recursive(dir, &mut entities)?;

        Ok(WorldTemplate { entities })
    }
}

fn load_from_dir_recursive(dir: &Path, entities: &mut Vec<EntityConfig>) -> Result<(), Box<dyn Error>> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            load_from_dir_recursive(&path, entities)?;
            continue;
        }

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

    Ok(())
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
    use crate::sidc::{status_from_sidc, Status};

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
    fn example_entity_components_are_loaded_correctly() {
        let dir = entities_dir();
        let template = WorldTemplate::load_from_dir(&dir)
            .unwrap_or_else(|e| panic!("failed to load entities from {:?}: {e}", dir));

        // Find the frigate defined in `example-red-ship.yaml`.
        let frigate = template
            .entities
            .iter()
            .find(|e| e.id == "frigate")
            .expect("expected an entity with id 'frigate'");

        assert!(
            matches!(frigate.allegiance, Allegiance::Hostile),
            "expected frigate allegiance to be 'hostile', got {:?}",
            frigate.allegiance
        );
        let symbol = frigate
            .components
            .iter()
            .find(|c| c.kind == "symbol")
            .expect("frigate should have a symbol component");
        let status_from_raw_sidc = symbol
            .data
            .get("sidc")
            .and_then(|v| v.as_str())
            .and_then(status_from_sidc);
        let status_from_template = symbol
            .data
            .get("sidc_template")
            .and_then(|v| v.get("status"))
            .and_then(|v| v.as_str())
            .and_then(|s| match s {
                "present_fully_capable" => Some(Status::PresentFullyCapable),
                "present" => Some(Status::Present),
                "planned_anticipated_suspect" => Some(Status::PlannedAnticipatedSuspect),
                "present_damage" => Some(Status::PresentDamage),
                "present_destroyed" => Some(Status::PresentDestroyed),
                "present_full_to_capacity" => Some(Status::PresentFullToCapacity),
                _ => None,
            });
        assert!(
            matches!(
                status_from_raw_sidc.or(status_from_template),
                Some(Status::PresentFullyCapable)
            ),
            "expected frigate status to decode as PresentFullyCapable from sidc or sidc_template"
        );

        // We expect three components: transform, movement, symbol.
        assert_eq!(
            frigate.components.len(),
            3,
            "frigate should have exactly three components"
        );

        let mut kinds: Vec<&str> = frigate.components.iter().map(|c| c.kind.as_str()).collect();
        kinds.sort_unstable();

        assert_eq!(kinds, vec!["movement", "symbol", "transform"]);

        // Ensure that component data objects were deserialized and are not empty.
        for component in &frigate.components {
            assert!(
                !component.data.is_null(),
                "component '{}' has null data",
                component.kind
            );
        }

        // Spot-check some transform fields expected by the map UI.
        let transform = frigate
            .components
            .iter()
            .find(|c| c.kind == "transform")
            .expect("frigate should have a transform component");

        for key in ["lat_deg", "lon_deg", "hae_m", "heading_deg"] {
            assert!(
                transform.data.get(key).is_some(),
                "transform.data missing key '{key}': {:?}",
                transform.data
            );
        }

        // Spot-check that symbol config uses sidc_template only.
        assert!(
            symbol.data.get("sidc_template").is_some(),
            "symbol.data missing 'sidc_template': {:?}",
            symbol.data
        );
    }
}

