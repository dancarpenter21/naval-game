//! Scenario definitions loaded from `config/scenarios/*.yaml`.

use serde::Deserialize;
use std::fs;
use std::path::Path;

/// Reference to an entity template, optionally with scenario-specific starting pose.
/// YAML: either a string template id (`frigate`) or a mapping (`id: frigate`, `lat_deg: …`, …).
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ScenarioEntityRef {
    /// Use template id only; starting location comes from `config/entities`.
    TemplateId(String),
    /// Template id plus optional fields; omitted pose fields keep template defaults.
    Placement {
        #[serde(alias = "entity_id")]
        id: String,
        #[serde(default)]
        lat_deg: Option<f64>,
        #[serde(default)]
        lon_deg: Option<f64>,
        #[serde(default)]
        hae_m: Option<f64>,
        #[serde(default)]
        heading_deg: Option<f64>,
    },
}

impl ScenarioEntityRef {
    pub fn template_id(&self) -> &str {
        match self {
            ScenarioEntityRef::TemplateId(s) => s.as_str(),
            ScenarioEntityRef::Placement { id, .. } => id.as_str(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ScenarioConfig {
    /// Human-readable title; if omitted, derived from the filename.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub win_conditions: String,
    /// Entity template refs (should match `allegiance: hostile` in entity YAML).
    #[serde(default, alias = "red")]
    pub red_entities: Vec<ScenarioEntityRef>,
    /// Entity template refs (should match `allegiance: friendly` in entity YAML).
    #[serde(default, alias = "blue")]
    pub blue_entities: Vec<ScenarioEntityRef>,
    /// Explicit spawn counts. When non-empty, overrides red/blue entity lists for spawning.
    #[serde(default)]
    pub spawns: Vec<ScenarioSpawn>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScenarioSpawn {
    #[serde(rename = "entity_id", alias = "id")]
    pub entity_id: String,
    #[serde(default = "default_spawn_count")]
    pub count: u32,
}

fn default_spawn_count() -> u32 {
    1
}

#[derive(Debug, Clone)]
pub struct LoadedScenario {
    pub id: String,
    pub config: ScenarioConfig,
}

impl LoadedScenario {
    pub fn display_name(&self) -> String {
        self.config
            .name
            .clone()
            .unwrap_or_else(|| title_case_from_id(&self.id))
    }
}

fn title_case_from_id(id: &str) -> String {
    id.replace('-', " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Load every `*.yaml` / `*.yml` in `dir` (non-recursive). Invalid files are skipped with a warning log.
pub fn load_scenarios_from_dir(dir: &Path) -> Result<Vec<LoadedScenario>, std::io::Error> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        tracing::warn!("Scenarios directory {:?} missing; no scenarios loaded", dir);
        return Ok(out);
    }

    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map_or(false, |ext| {
                ext == "yaml" || ext == "yml"
            })
        })
        .collect();
    entries.sort_by_key(|e| e.path());

    for entry in entries {
        let path = entry.path();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("scenario")
            .to_string();

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Failed to read scenario {:?}: {}", path, e);
                continue;
            }
        };

        let trimmed = content.trim();
        if trimmed.is_empty() {
            tracing::warn!("Skipping empty scenario file {:?}", path);
            continue;
        }

        match serde_yaml::from_str::<ScenarioConfig>(&content) {
            Ok(config) => {
                tracing::info!("Loaded scenario id={} from {:?}", stem, path);
                out.push(LoadedScenario {
                    id: stem,
                    config,
                });
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to parse scenario {:?} ({}); skipping file.",
                    path,
                    e
                );
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn missing_path_returns_empty_ok() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("not_a_directory");
        let loaded = load_scenarios_from_dir(&missing).unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn empty_directory_returns_empty_vec() {
        let dir = tempdir().unwrap();
        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn loads_valid_yaml_and_uses_file_stem_as_id() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("coastal-patrol.yaml");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(
                b"name: Coastal patrol
description: Test description line.
win_conditions: Win by surviving.
red_entities:
  - a
blue_entities:
  - b
",
            )
            .unwrap();

        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "coastal-patrol");
        assert_eq!(loaded[0].config.name.as_deref(), Some("Coastal patrol"));
        assert_eq!(loaded[0].config.description, "Test description line.");
        assert_eq!(loaded[0].config.win_conditions, "Win by surviving.");
        assert_eq!(
            loaded[0].config.red_entities,
            vec![ScenarioEntityRef::TemplateId("a".into())]
        );
        assert_eq!(
            loaded[0].config.blue_entities,
            vec![ScenarioEntityRef::TemplateId("b".into())]
        );
        assert_eq!(loaded[0].display_name(), "Coastal patrol");
    }

    #[test]
    fn yml_extension_is_loaded() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("mini.yml");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(b"description: x\n")
            .unwrap();

        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "mini");
    }

    #[test]
    fn skips_empty_file_and_invalid_yaml() {
        let dir = tempdir().unwrap();
        std::fs::File::create(dir.path().join("empty.yaml"))
            .unwrap()
            .write_all(b"   \n  \n")
            .unwrap();
        std::fs::File::create(dir.path().join("bad.yaml"))
            .unwrap()
            .write_all(b"- not a mapping root\n")
            .unwrap();
        std::fs::File::create(dir.path().join("good.yaml"))
            .unwrap()
            .write_all(b"description: ok\n")
            .unwrap();

        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "good");
        assert_eq!(loaded[0].config.description, "ok");
    }

    #[test]
    fn ignores_non_yaml_files() {
        let dir = tempdir().unwrap();
        std::fs::File::create(dir.path().join("readme.txt"))
            .unwrap()
            .write_all(b"description: sneaky\n")
            .unwrap();
        std::fs::File::create(dir.path().join("only.yaml"))
            .unwrap()
            .write_all(b"description: y\n")
            .unwrap();

        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "only");
    }

    #[test]
    fn scenarios_are_sorted_by_path() {
        let dir = tempdir().unwrap();
        for (name, desc) in [("b.yaml", "second"), ("a.yaml", "first")] {
            std::fs::File::create(dir.path().join(name))
                .unwrap()
                .write_all(format!("description: {desc}\n").as_bytes())
                .unwrap();
        }

        let loaded = load_scenarios_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[1].id, "b");
    }

    #[test]
    fn deserializes_red_and_blue_key_aliases() {
        let yaml = r#"
description: d
win_conditions: w
red:
  - r1
blue:
  - b1
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            cfg.red_entities,
            vec![ScenarioEntityRef::TemplateId("r1".into())]
        );
        assert_eq!(
            cfg.blue_entities,
            vec![ScenarioEntityRef::TemplateId("b1".into())]
        );
    }

    #[test]
    fn deserializes_entity_placement_with_pose() {
        let yaml = r#"
red_entities:
  - id: frigate
    lat_deg: 10.0
    heading_deg: 45.0
blue_entities:
  - entity_id: blue-airplane
    lon_deg: -20.0
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            cfg.red_entities,
            vec![ScenarioEntityRef::Placement {
                id: "frigate".into(),
                lat_deg: Some(10.0),
                lon_deg: None,
                hae_m: None,
                heading_deg: Some(45.0),
            }]
        );
        assert_eq!(
            cfg.blue_entities,
            vec![ScenarioEntityRef::Placement {
                id: "blue-airplane".into(),
                lat_deg: None,
                lon_deg: Some(-20.0),
                hae_m: None,
                heading_deg: None,
            }]
        );
    }

    #[test]
    fn deserializes_mixed_string_and_placement_entries() {
        let yaml = r#"
red_entities:
  - frigate
  - id: other-red
    lat_deg: 1.0
blue_entities:
  - blue-airplane
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.red_entities.len(), 2);
        assert_eq!(
            cfg.red_entities[0],
            ScenarioEntityRef::TemplateId("frigate".into())
        );
        assert!(matches!(
            &cfg.red_entities[1],
            ScenarioEntityRef::Placement { id, lat_deg: Some(1.0), .. } if id == "other-red"
        ));
    }

    #[test]
    fn deserializes_spawn_entity_id_alias() {
        let yaml = r#"
spawns:
  - id: ship-a
    count: 2
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.spawns.len(), 1);
        assert_eq!(cfg.spawns[0].entity_id, "ship-a");
        assert_eq!(cfg.spawns[0].count, 2);
    }

    #[test]
    fn spawn_default_count_is_one() {
        let yaml = r#"
spawns:
  - entity_id: only-one
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.spawns[0].count, 1);
    }

    #[test]
    fn display_name_defaults_to_title_case_from_id() {
        let s = LoadedScenario {
            id: "north-atlantic-exercise".into(),
            config: ScenarioConfig::default(),
        };
        assert_eq!(s.display_name(), "North Atlantic Exercise");
    }
}
