//! Scenario definitions loaded from `config/scenarios/*.yaml`.

use crate::dto::{AuthorityNodeDto, SymbolScenarioPatch};
use serde::Deserialize;
use std::collections::HashMap;
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
        hae_ft: Option<f64>,
        #[serde(default)]
        heading_deg: Option<f64>,
        /// Per-mount loadout: mount id → entity template id (must be allowed by the template hardpoint).
        #[serde(default)]
        hardpoints: Option<HashMap<String, String>>,
        /// Merged over the entity template `symbol` component (scenario wins per field).
        #[serde(default)]
        symbol: Option<SymbolScenarioPatch>,
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

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type", content = "params", rename_all = "snake_case")]
pub enum ObjectiveCondition {
    SurviveTime { 
        duration_s: f64 
    },
    DestroyEntity { 
        target_id: String, 
        #[serde(default)]
        time_limit_s: Option<f64> 
    },
    ReachArea { 
        target_id: String, 
        lat_deg: f64, 
        lon_deg: f64, 
        radius_m: f64 
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ObjectiveConfig {
    pub id: String,
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(flatten)]
    pub condition: ObjectiveCondition,
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct ScenarioObjectives {
    #[serde(default)]
    pub red: Vec<ObjectiveConfig>,
    #[serde(default)]
    pub blue: Vec<ObjectiveConfig>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ScenarioConfig {
    /// Human-readable title; if omitted, derived from the filename.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub win_conditions: Option<String>,
    #[serde(default)]
    pub objectives: Option<ScenarioObjectives>,
    /// Entity template refs (should match `allegiance: hostile` in entity YAML).
    #[serde(default, alias = "red")]
    pub red_entities: Vec<ScenarioEntityRef>,
    /// Entity template refs (should match `allegiance: friendly` in entity YAML).
    #[serde(default, alias = "blue")]
    pub blue_entities: Vec<ScenarioEntityRef>,
    /// Explicit spawn counts. When non-empty, overrides red/blue entity lists for spawning.
    #[serde(default)]
    pub spawns: Vec<ScenarioSpawn>,
    /// Optional command-and-control authority tree (rendered in the client Authorities tab).
    #[serde(default)]
    pub authorities: Vec<AuthorityNodeDto>,
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

    pub fn formatted_win_conditions(&self) -> String {
        let mut s = String::new();
        if let Some(ref w) = self.config.win_conditions {
            s.push_str(w);
            s.push_str("\n\n");
        }
        if let Some(ref o) = self.config.objectives {
            if !o.blue.is_empty() {
                s.push_str("Blue Objectives:\n");
                for obj in &o.blue {
                    s.push_str(&format!("- {}\n", obj.description.as_deref().unwrap_or(&obj.id)));
                }
            }
            if !o.red.is_empty() {
                if !o.blue.is_empty() {
                    s.push_str("\n");
                }
                s.push_str("Red Objectives:\n");
                for obj in &o.red {
                    s.push_str(&format!("- {}\n", obj.description.as_deref().unwrap_or(&obj.id)));
                }
            }
        }
        s.trim().to_string()
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
        assert_eq!(
            loaded[0].config.win_conditions.as_deref(),
            Some("Win by surviving.")
        );
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
                hae_ft: None,
                heading_deg: Some(45.0),
                hardpoints: None,
                symbol: None,
            }]
        );
        assert_eq!(
            cfg.blue_entities,
            vec![ScenarioEntityRef::Placement {
                id: "blue-airplane".into(),
                lat_deg: None,
                lon_deg: Some(-20.0),
                hae_ft: None,
                heading_deg: None,
                hardpoints: None,
                symbol: None,
            }]
        );
    }

    #[test]
    fn deserializes_entity_placement_with_symbol_patch() {
        use crate::dto::{CesiumShapeDto, SymbolScenarioPatch};

        let yaml = r##"
blue_entities:
  - id: frigate
    lat_deg: 1.0
    symbol:
      map_icon_image_url: icons/mark.png
      map_cesium_shape:
        kind: sphere
        radius_px: 10.0
        color: "#00ff88"
"##;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            cfg.blue_entities,
            vec![ScenarioEntityRef::Placement {
                id: "frigate".into(),
                lat_deg: Some(1.0),
                lon_deg: None,
                hae_ft: None,
                heading_deg: None,
                hardpoints: None,
                symbol: Some(SymbolScenarioPatch {
                    sidc_template: None,
                    map_icon_glb_override: None,
                    map_icon_glb_url: None,
                    map_icon_image_url: Some("icons/mark.png".into()),
                    map_cesium_shape: Some(CesiumShapeDto::Sphere {
                        radius_px: 10.0,
                        color: Some("#00ff88".into()),
                    }),
                }),
            }]
        );
    }

    #[test]
    fn deserializes_entity_placement_with_hardpoints_loadout() {
        let yaml = r#"
blue_entities:
  - id: blue-airplane
    lat_deg: 1.0
    hardpoints:
      hp1: blue-missile
      hp2: blue-missile
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        let mut expected = HashMap::new();
        expected.insert("hp1".into(), "blue-missile".into());
        expected.insert("hp2".into(), "blue-missile".into());
        assert_eq!(
            cfg.blue_entities,
            vec![ScenarioEntityRef::Placement {
                id: "blue-airplane".into(),
                lat_deg: Some(1.0),
                lon_deg: None,
                hae_ft: None,
                heading_deg: None,
                hardpoints: Some(expected),
                symbol: None,
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

    #[test]
    fn deserializes_authorities_nested() {
        let yaml = r#"
authorities:
  - id: root
    title: Root office
    children:
      - id: child
        name: Child role
        role: Example
        image_url: https://example.com/x.png
"#;
        let cfg: ScenarioConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.authorities.len(), 1);
        assert_eq!(cfg.authorities[0].id, "root");
        assert_eq!(cfg.authorities[0].children.len(), 1);
        assert_eq!(cfg.authorities[0].children[0].id, "child");
        assert_eq!(
            cfg.authorities[0].children[0].image_url.as_deref(),
            Some("https://example.com/x.png")
        );
    }
}
