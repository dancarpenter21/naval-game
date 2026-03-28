// SIDC field layout and value mappings in this module are informed by:
// https://github.com/kjellmf/sidc-picker (MIT License)
// and specifically its `src/symbology/sidc.js` and `src/symbology/values.js`.
// This file contains a Rust adaptation for server-side use.

#![allow(dead_code)] // Parsers/helpers mirror JS reference; not all are wired into the game yet.

use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize};
use std::fmt;

const SIDC_SEGMENT_LENGTHS: [usize; 10] = [2, 1, 1, 2, 1, 1, 2, 6, 2, 2];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Context {
    Reality,
    Exercise,
    Simulation,
}

impl Context {
    pub fn from_digit(digit: char) -> Option<Self> {
        match digit {
            '0' => Some(Context::Reality),
            '1' => Some(Context::Exercise),
            '2' => Some(Context::Simulation),
            _ => None,
        }
    }

    pub fn to_digit(self) -> char {
        match self {
            Context::Reality => '0',
            Context::Exercise => '1',
            Context::Simulation => '2',
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardIdentity {
    Pending,
    Unknown,
    AssumedFriend,
    Friend,
    Neutral,
    SuspectJoker,
    HostileFaker,
}

impl StandardIdentity {
    pub fn from_digit(digit: char) -> Option<Self> {
        match digit {
            '0' => Some(StandardIdentity::Pending),
            '1' => Some(StandardIdentity::Unknown),
            '2' => Some(StandardIdentity::AssumedFriend),
            '3' => Some(StandardIdentity::Friend),
            '4' => Some(StandardIdentity::Neutral),
            '5' => Some(StandardIdentity::SuspectJoker),
            '6' => Some(StandardIdentity::HostileFaker),
            _ => None,
        }
    }

    pub fn to_digit(self) -> char {
        match self {
            StandardIdentity::Pending => '0',
            StandardIdentity::Unknown => '1',
            StandardIdentity::AssumedFriend => '2',
            StandardIdentity::Friend => '3',
            StandardIdentity::Neutral => '4',
            StandardIdentity::SuspectJoker => '5',
            StandardIdentity::HostileFaker => '6',
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolSet {
    Air,
    Missile,
    Space,
    Unit,
    Civilian,
    Equipment,
    Installation,
    ControlMeasure,
    Dismounted,
    Surface,
    Subsurface,
    Mine,
    Activity,
}

impl SymbolSet {
    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "01" => Some(SymbolSet::Air),
            "02" => Some(SymbolSet::Missile),
            "05" => Some(SymbolSet::Space),
            "10" => Some(SymbolSet::Unit),
            "11" => Some(SymbolSet::Civilian),
            "15" => Some(SymbolSet::Equipment),
            "20" => Some(SymbolSet::Installation),
            "25" => Some(SymbolSet::ControlMeasure),
            "27" => Some(SymbolSet::Dismounted),
            "30" => Some(SymbolSet::Surface),
            "35" => Some(SymbolSet::Subsurface),
            "36" => Some(SymbolSet::Mine),
            "40" => Some(SymbolSet::Activity),
            _ => None,
        }
    }

    pub fn to_code(self) -> &'static str {
        match self {
            SymbolSet::Air => "01",
            SymbolSet::Missile => "02",
            SymbolSet::Space => "05",
            SymbolSet::Unit => "10",
            SymbolSet::Civilian => "11",
            SymbolSet::Equipment => "15",
            SymbolSet::Installation => "20",
            SymbolSet::ControlMeasure => "25",
            SymbolSet::Dismounted => "27",
            SymbolSet::Surface => "30",
            SymbolSet::Subsurface => "35",
            SymbolSet::Mine => "36",
            SymbolSet::Activity => "40",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Present,
    PlannedAnticipatedSuspect,
    PresentFullyCapable,
    PresentDamage,
    PresentDestroyed,
    PresentFullToCapacity,
}

impl Status {
    pub fn from_digit(digit: char) -> Option<Self> {
        match digit {
            '0' => Some(Status::Present),
            '1' => Some(Status::PlannedAnticipatedSuspect),
            '2' => Some(Status::PresentFullyCapable),
            '3' => Some(Status::PresentDamage),
            '4' => Some(Status::PresentDestroyed),
            '5' => Some(Status::PresentFullToCapacity),
            _ => None,
        }
    }

    pub fn to_digit(&self) -> char {
        match self {
            Status::Present => '0',
            Status::PlannedAnticipatedSuspect => '1',
            Status::PresentFullyCapable => '2',
            Status::PresentDamage => '3',
            Status::PresentDestroyed => '4',
            Status::PresentFullToCapacity => '5',
        }
    }
}

fn default_version() -> String {
    "10".to_string()
}

fn default_status() -> Status {
    Status::Present
}

// --- HQTFD (headquarters / task force / dummy) -------------------------------------------------
// Matches sidc-picker `HQTFDummyValues` (values.js).

/// Headquarters / task force / dummy field (one digit in the SIDC).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Hqtfd {
    NotApplicable,
    FeintDummy,
    Headquarters,
    FeintDummyHeadquarters,
    TaskForce,
    FeintDummyTaskForce,
    TaskForceHeadquarters,
    FeintDummyTaskForceHeadquarters,
}

impl Default for Hqtfd {
    fn default() -> Self {
        Hqtfd::NotApplicable
    }
}

impl Hqtfd {
    pub fn to_digit_char(self) -> char {
        match self {
            Hqtfd::NotApplicable => '0',
            Hqtfd::FeintDummy => '1',
            Hqtfd::Headquarters => '2',
            Hqtfd::FeintDummyHeadquarters => '3',
            Hqtfd::TaskForce => '4',
            Hqtfd::FeintDummyTaskForce => '5',
            Hqtfd::TaskForceHeadquarters => '6',
            Hqtfd::FeintDummyTaskForceHeadquarters => '7',
        }
    }

    fn parse(s: &str) -> Result<Self, String> {
        let t = s.trim();
        if t.len() == 1 {
            let c = t.chars().next().unwrap();
            if let Some(v) = c.to_digit(10) {
                if v <= 7 {
                    return Self::from_digit(v as u8);
                }
            }
        }
        match t {
            "not_applicable" => Ok(Hqtfd::NotApplicable),
            "feint_dummy" => Ok(Hqtfd::FeintDummy),
            "headquarters" => Ok(Hqtfd::Headquarters),
            "feint_dummy_headquarters" => Ok(Hqtfd::FeintDummyHeadquarters),
            "task_force" => Ok(Hqtfd::TaskForce),
            "feint_dummy_task_force" => Ok(Hqtfd::FeintDummyTaskForce),
            "task_force_headquarters" => Ok(Hqtfd::TaskForceHeadquarters),
            "feint_dummy_task_force_headquarters" => Ok(Hqtfd::FeintDummyTaskForceHeadquarters),
            _ => Err(format!("unknown hqtfd value: {t:?}")),
        }
    }

    fn from_digit(d: u8) -> Result<Self, String> {
        match d {
            0 => Ok(Hqtfd::NotApplicable),
            1 => Ok(Hqtfd::FeintDummy),
            2 => Ok(Hqtfd::Headquarters),
            3 => Ok(Hqtfd::FeintDummyHeadquarters),
            4 => Ok(Hqtfd::TaskForce),
            5 => Ok(Hqtfd::FeintDummyTaskForce),
            6 => Ok(Hqtfd::TaskForceHeadquarters),
            7 => Ok(Hqtfd::FeintDummyTaskForceHeadquarters),
            _ => Err(format!("hqtfd digit out of range: {d}")),
        }
    }
}

impl<'de> Deserialize<'de> for Hqtfd {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct HqtfdVisitor;
        impl<'de> Visitor<'de> for HqtfdVisitor {
            type Value = Hqtfd;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("hqtfd snake_case name or single digit 0-7")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Hqtfd, E> {
                Hqtfd::parse(v).map_err(E::custom)
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Hqtfd, E> {
                if v <= 7 {
                    Hqtfd::from_digit(v as u8).map_err(E::custom)
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(v), &"0-7"))
                }
            }
        }

        deserializer.deserialize_any(HqtfdVisitor)
    }
}

// --- Amplifier (EMT / echelon–mobility–towed, etc.) ---------------------------------------------
//
// Same code lists as the static SIDC builder (`client/public/sidc-picker/index.html`) and
// https://github.com/kjellmf/sidc-picker `src/symbology/values.js` + `SidcPicker.vue` `emtValues`.

/// Default amplifier: unspecified (`00`).
pub const AMPLIFIER_UNSPECIFIED: &str = "00";

/// Echelon / mobility / leadership / towed-array amplifier field (two SIDC digits).
/// YAML may use snake_case names (preferred) or legacy two-digit strings (`"00"`, `"16"`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Amplifier {
    Unspecified,
    TeamCrew,
    Squad,
    Section,
    PlatoonDetachment,
    CompanyBatteryTroop,
    BattalionSquadron,
    RegimentGroup,
    Brigade,
    Division,
    CorpsMef,
    Army,
    ArmyGroupFront,
    RegionTheater,
    Command,
    WheeledLimitedCrossCountry,
    WheeledCrossCountry,
    Tracked,
    WheeledAndTrackedCombination,
    Towed,
    Railway,
    PackAnimals,
    OverSnowPrimeMover,
    Sled,
    Barge,
    Amphibious,
    Leader,
    ShortTowedArray,
    LongTowedArray,
}

impl Default for Amplifier {
    fn default() -> Self {
        Amplifier::Unspecified
    }
}

impl Amplifier {
    pub fn to_code(self) -> &'static str {
        match self {
            Amplifier::Unspecified => "00",
            Amplifier::TeamCrew => "11",
            Amplifier::Squad => "12",
            Amplifier::Section => "13",
            Amplifier::PlatoonDetachment => "14",
            Amplifier::CompanyBatteryTroop => "15",
            Amplifier::BattalionSquadron => "16",
            Amplifier::RegimentGroup => "17",
            Amplifier::Brigade => "18",
            Amplifier::Division => "21",
            Amplifier::CorpsMef => "22",
            Amplifier::Army => "23",
            Amplifier::ArmyGroupFront => "24",
            Amplifier::RegionTheater => "25",
            Amplifier::Command => "26",
            Amplifier::WheeledLimitedCrossCountry => "31",
            Amplifier::WheeledCrossCountry => "32",
            Amplifier::Tracked => "33",
            Amplifier::WheeledAndTrackedCombination => "34",
            Amplifier::Towed => "35",
            Amplifier::Railway => "36",
            Amplifier::PackAnimals => "37",
            Amplifier::OverSnowPrimeMover => "41",
            Amplifier::Sled => "42",
            Amplifier::Barge => "51",
            Amplifier::Amphibious => "52",
            Amplifier::Leader => "71",
            Amplifier::ShortTowedArray => "61",
            Amplifier::LongTowedArray => "62",
        }
    }

    fn from_two_digit_code(t: &str) -> Result<Self, String> {
        match t {
            "00" => Ok(Amplifier::Unspecified),
            "11" => Ok(Amplifier::TeamCrew),
            "12" => Ok(Amplifier::Squad),
            "13" => Ok(Amplifier::Section),
            "14" => Ok(Amplifier::PlatoonDetachment),
            "15" => Ok(Amplifier::CompanyBatteryTroop),
            "16" => Ok(Amplifier::BattalionSquadron),
            "17" => Ok(Amplifier::RegimentGroup),
            "18" => Ok(Amplifier::Brigade),
            "21" => Ok(Amplifier::Division),
            "22" => Ok(Amplifier::CorpsMef),
            "23" => Ok(Amplifier::Army),
            "24" => Ok(Amplifier::ArmyGroupFront),
            "25" => Ok(Amplifier::RegionTheater),
            "26" => Ok(Amplifier::Command),
            "31" => Ok(Amplifier::WheeledLimitedCrossCountry),
            "32" => Ok(Amplifier::WheeledCrossCountry),
            "33" => Ok(Amplifier::Tracked),
            "34" => Ok(Amplifier::WheeledAndTrackedCombination),
            "35" => Ok(Amplifier::Towed),
            "36" => Ok(Amplifier::Railway),
            "37" => Ok(Amplifier::PackAnimals),
            "41" => Ok(Amplifier::OverSnowPrimeMover),
            "42" => Ok(Amplifier::Sled),
            "51" => Ok(Amplifier::Barge),
            "52" => Ok(Amplifier::Amphibious),
            "71" => Ok(Amplifier::Leader),
            "61" => Ok(Amplifier::ShortTowedArray),
            "62" => Ok(Amplifier::LongTowedArray),
            _ => Err(format!("unknown 2-digit amplifier code: {t:?}")),
        }
    }

    fn parse(s: &str) -> Result<Self, String> {
        let t = s.trim();
        if t.len() == 2 && t.chars().all(|c| c.is_ascii_digit()) {
            return Self::from_two_digit_code(t);
        }
        match t {
            "unspecified" => Ok(Amplifier::Unspecified),
            "team_crew" => Ok(Amplifier::TeamCrew),
            "squad" => Ok(Amplifier::Squad),
            "section" => Ok(Amplifier::Section),
            "platoon_detachment" => Ok(Amplifier::PlatoonDetachment),
            "company_battery_troop" => Ok(Amplifier::CompanyBatteryTroop),
            "battalion_squadron" => Ok(Amplifier::BattalionSquadron),
            "regiment_group" => Ok(Amplifier::RegimentGroup),
            "brigade" => Ok(Amplifier::Brigade),
            "division" => Ok(Amplifier::Division),
            "corps_mef" => Ok(Amplifier::CorpsMef),
            "army" => Ok(Amplifier::Army),
            "army_group_front" => Ok(Amplifier::ArmyGroupFront),
            "region_theater" => Ok(Amplifier::RegionTheater),
            "command" => Ok(Amplifier::Command),
            "wheeled_limited_cross_country" => Ok(Amplifier::WheeledLimitedCrossCountry),
            "wheeled_cross_country" => Ok(Amplifier::WheeledCrossCountry),
            "tracked" => Ok(Amplifier::Tracked),
            "wheeled_and_tracked_combination" => Ok(Amplifier::WheeledAndTrackedCombination),
            "towed" => Ok(Amplifier::Towed),
            "railway" => Ok(Amplifier::Railway),
            "pack_animals" => Ok(Amplifier::PackAnimals),
            "over_snow_prime_mover" => Ok(Amplifier::OverSnowPrimeMover),
            "sled" => Ok(Amplifier::Sled),
            "barge" => Ok(Amplifier::Barge),
            "amphibious" => Ok(Amplifier::Amphibious),
            "leader" => Ok(Amplifier::Leader),
            "short_towed_array" => Ok(Amplifier::ShortTowedArray),
            "long_towed_array" => Ok(Amplifier::LongTowedArray),
            _ => Err(format!("unknown amplifier value: {t:?}")),
        }
    }
}

impl<'de> Deserialize<'de> for Amplifier {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct AmplifierVisitor;
        impl<'de> Visitor<'de> for AmplifierVisitor {
            type Value = Amplifier;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("amplifier snake_case name or 2-digit code")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Amplifier, E> {
                Amplifier::parse(v).map_err(E::custom)
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Amplifier, E> {
                if v < 100 {
                    Amplifier::parse(&format!("{v:02}")).map_err(E::custom)
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(v), &"0-99"))
                }
            }
        }

        deserializer.deserialize_any(AmplifierVisitor)
    }
}

/// Land unit (symbol set `10`): echelon / size.
pub const ECHELON_AMPLIFIER_CODES: &[&str] = &[
    "00", "11", "12", "13", "14", "15", "16", "17", "18", "21", "22", "23", "24", "25", "26",
];

/// Land equipment (symbol set `15`): mobility.
pub const MOBILITY_AMPLIFIER_CODES: &[&str] = &[
    "00", "31", "32", "33", "34", "35", "36", "37", "41", "42", "51", "52",
];

/// Dismounted individual (symbol set `27`): leadership.
pub const LEADERSHIP_AMPLIFIER_CODES: &[&str] = &["00", "71"];

/// Sea surface / subsurface (symbol sets `30` / `35`): towed array.
pub const TOWED_ARRAY_AMPLIFIER_CODES: &[&str] = &["00", "61", "62"];

/// Symbol sets where the picker only offers “Unspecified” for this field.
pub const AMPLIFIER_UNSPECIFIED_ONLY_CODES: &[&str] = &["00"];

/// Return the allowed two-digit amplifier strings for a symbol set (APP-6 / sidc-picker rules).
pub fn amplifier_codes_for_symbol_set(set: SymbolSet) -> &'static [&'static str] {
    match set {
        SymbolSet::Unit => ECHELON_AMPLIFIER_CODES,
        SymbolSet::Equipment => MOBILITY_AMPLIFIER_CODES,
        SymbolSet::Dismounted => LEADERSHIP_AMPLIFIER_CODES,
        SymbolSet::Surface | SymbolSet::Subsurface => TOWED_ARRAY_AMPLIFIER_CODES,
        SymbolSet::Air
        | SymbolSet::Missile
        | SymbolSet::Space
        | SymbolSet::Civilian
        | SymbolSet::Installation
        | SymbolSet::ControlMeasure
        | SymbolSet::Mine
        | SymbolSet::Activity => AMPLIFIER_UNSPECIFIED_ONLY_CODES,
    }
}

/// `true` if `amplifier` is a permitted two-digit code for `symbol_set`.
pub fn amplifier_is_valid_for_symbol_set(symbol_set: SymbolSet, amplifier: &str) -> bool {
    amplifier_codes_for_symbol_set(symbol_set)
        .iter()
        .any(|&c| c == amplifier)
}

// --- Entity & modifiers ------------------------------------------------------------------------
//
// Main icon (`entity`) and modifier slots are symbol-set-specific in APP-6D (`milstd` `app6d`),
// consistent with client map/picker rendering (milsymbol `APP6`). YAML may use `code_######` /
// `code_##` identifiers (preferred in generated
// snippets) or legacy quoted digit strings.

/// Default / “no modifier” value for `modifier_one` and `modifier_two`.
pub const MODIFIER_NONE: &str = "00";

/// Six-digit main icon entity code. Serializes as `code_######` for stable paste-friendly YAML.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityCode(String);

impl EntityCode {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        let t = s.trim();
        let digits: String = if let Some(rest) = t.strip_prefix("code_") {
            rest.chars().filter(|c| c.is_ascii_digit()).collect()
        } else {
            t.chars().filter(|c| c.is_ascii_digit()).collect()
        };
        if digits.len() != 6 {
            return Err(format!(
                "entity must be 6 digits or code_######, got {s:?} (parsed digits: {digits:?})"
            ));
        }
        Ok(EntityCode(digits))
    }
}

impl Serialize for EntityCode {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        format!("code_{}", self.0).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for EntityCode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = EntityCode;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("6-digit entity string or code_######")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<EntityCode, E> {
                EntityCode::parse(v).map_err(E::custom)
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<EntityCode, E> {
                if v > 999_999 {
                    return Err(E::invalid_value(de::Unexpected::Unsigned(v), &"0-999999"));
                }
                EntityCode::parse(&format!("{v:06}")).map_err(E::custom)
            }
        }

        deserializer.deserialize_any(V)
    }
}

/// Two-digit modifier slot. Serializes as `code_##`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModifierCode(String);

impl Default for ModifierCode {
    fn default() -> Self {
        ModifierCode("00".to_string())
    }
}

impl ModifierCode {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        let t = s.trim();
        let digits: String = if let Some(rest) = t.strip_prefix("code_") {
            rest.chars().filter(|c| c.is_ascii_digit()).collect()
        } else {
            t.chars().filter(|c| c.is_ascii_digit()).collect()
        };
        if digits.len() != 2 {
            return Err(format!(
                "modifier must be 2 digits or code_##, got {s:?} (parsed digits: {digits:?})"
            ));
        }
        Ok(ModifierCode(digits))
    }
}

impl Serialize for ModifierCode {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        format!("code_{}", self.0).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ModifierCode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = ModifierCode;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("2-digit modifier string or code_##")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<ModifierCode, E> {
                ModifierCode::parse(v).map_err(E::custom)
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<ModifierCode, E> {
                if v < 100 {
                    ModifierCode::parse(&format!("{v:02}")).map_err(E::custom)
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(v), &"0-99"))
                }
            }
        }

        deserializer.deserialize_any(V)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct SidcTemplate {
    #[serde(default = "default_version")]
    pub version: String,
    pub context: Context,
    pub standard_identity: StandardIdentity,
    pub symbol_set: SymbolSet,
    #[serde(default = "default_status")]
    pub status: Status,
    #[serde(default)]
    pub hqtfd: Hqtfd,
    /// Echelon, mobility, leadership, or towed-array value; must match [`SymbolSet`].
    #[serde(default)]
    pub amplifier: Amplifier,
    pub entity: EntityCode,
    #[serde(default)]
    pub modifier_one: ModifierCode,
    #[serde(default)]
    pub modifier_two: ModifierCode,
}

impl SidcTemplate {
    pub fn to_sidc_string(&self) -> Result<String, String> {
        let version = self.version.trim();
        if version.len() != 2 || !version.chars().all(|c| c.is_ascii_digit()) {
            return Err("sidc_template.version must be a 2-digit string".to_string());
        }

        let amplifier = self.amplifier.to_code();
        if !amplifier_is_valid_for_symbol_set(self.symbol_set, amplifier) {
            let allowed = amplifier_codes_for_symbol_set(self.symbol_set).join(", ");
            return Err(format!(
                "sidc_template.amplifier {:?} is not valid for symbol_set {:?}; allowed: {}",
                amplifier, self.symbol_set, allowed
            ));
        }

        let entity = self.entity.as_str();
        if entity.len() != 6 || !entity.chars().all(|c| c.is_ascii_digit()) {
            return Err("sidc_template.entity must be a 6-digit string".to_string());
        }

        let modifier_one = self.modifier_one.as_str();
        let modifier_two = self.modifier_two.as_str();
        if modifier_one.len() != 2 || !modifier_one.chars().all(|c| c.is_ascii_digit()) {
            return Err("sidc_template.modifier_one must be a 2-digit string".to_string());
        }
        if modifier_two.len() != 2 || !modifier_two.chars().all(|c| c.is_ascii_digit()) {
            return Err("sidc_template.modifier_two must be a 2-digit string".to_string());
        }

        Ok(format!(
            "{}-{}-{}-{}-{}-{}-{}-{}-{}-{}",
            version,
            self.context.to_digit(),
            self.standard_identity.to_digit(),
            self.symbol_set.to_code(),
            self.status.to_digit(),
            self.hqtfd.to_digit_char(),
            amplifier,
            entity,
            modifier_one,
            modifier_two
        ))
    }
}

#[derive(Debug, Clone)]
pub struct Sidc {
    raw: String,
}

impl Sidc {
    pub fn parse(raw: &str) -> Option<Self> {
        if !is_valid_hyphenated_sidc(raw) {
            return None;
        }
        Some(Self { raw: raw.to_string() })
    }

    pub fn raw(&self) -> &str {
        &self.raw
    }

    pub fn compact(&self) -> String {
        self.raw.replace('-', "")
    }

    pub fn context(&self) -> Option<Context> {
        let compact = self.compact();
        let digit = compact.chars().nth(2)?;
        Context::from_digit(digit)
    }

    pub fn standard_identity(&self) -> Option<StandardIdentity> {
        let compact = self.compact();
        let digit = compact.chars().nth(3)?;
        StandardIdentity::from_digit(digit)
    }

    pub fn symbol_set(&self) -> Option<SymbolSet> {
        let compact = self.compact();
        let code = compact.get(4..6)?;
        SymbolSet::from_code(code)
    }

    pub fn status(&self) -> Option<Status> {
        status_from_sidc(&self.raw)
    }

    pub fn with_status(&self, status: Status) -> Option<String> {
        sidc_with_status(&self.raw, status)
    }
}

pub fn is_valid_hyphenated_sidc(sidc: &str) -> bool {
    let parts: Vec<&str> = sidc.split('-').collect();
    if parts.len() != SIDC_SEGMENT_LENGTHS.len() {
        return false;
    }

    parts
        .iter()
        .zip(SIDC_SEGMENT_LENGTHS.iter())
        .all(|(part, expected_len)| {
            part.len() == *expected_len && part.chars().all(|c| c.is_ascii_digit())
        })
}

/// Read status from SIDC.
/// Uses the 5th hyphen-delimited segment (index 4).
/// Non-hyphenated SIDC strings are intentionally unsupported on the server.
pub fn status_from_sidc(sidc: &str) -> Option<Status> {
    if !is_valid_hyphenated_sidc(sidc) {
        return None;
    }

    let parts: Vec<&str> = sidc.split('-').collect();
    let status_part = parts.get(4)?;
    let digit = status_part.chars().next()?;
    Status::from_digit(digit)
}

/// Return SIDC with status updated in-place.
/// Updates the 5th hyphen-delimited segment (index 4).
/// Non-hyphenated SIDC strings are intentionally unsupported on the server.
pub fn sidc_with_status(sidc: &str, status: Status) -> Option<String> {
    if !is_valid_hyphenated_sidc(sidc) {
        return None;
    }

    let mut parts: Vec<String> = sidc.split('-').map(ToString::to_string).collect();
    if parts.len() <= 4 {
        return None;
    }
    parts[4] = status.to_digit().to_string();
    Some(parts.join("-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hyphenated_sidc_fields() {
        let sidc = Sidc::parse("10-0-6-30-2-0-00-120204-00-00").expect("valid SIDC");
        assert!(matches!(sidc.context(), Some(Context::Reality)));
        assert!(matches!(
            sidc.standard_identity(),
            Some(StandardIdentity::HostileFaker)
        ));
        assert!(matches!(sidc.symbol_set(), Some(SymbolSet::Surface)));
        assert!(matches!(sidc.status(), Some(Status::PresentFullyCapable)));
        assert_eq!(sidc.compact(), "10063020001202040000");
    }

    #[test]
    fn updates_status_slot_in_sidc() {
        let updated = sidc_with_status("10-0-6-30-2-0-00-120204-00-00", Status::PresentDestroyed)
            .expect("status update should succeed");
        assert_eq!(updated, "10-0-6-30-4-0-00-120204-00-00");
    }

    #[test]
    fn rejects_non_hyphenated_sidc() {
        assert!(!is_valid_hyphenated_sidc("10063020001202040000"));
        assert!(Sidc::parse("10063020001202040000").is_none());
        assert!(status_from_sidc("10063020001202040000").is_none());
        assert!(sidc_with_status("10063020001202040000", Status::Present).is_none());
    }

    #[test]
    fn builds_sidc_from_template_enums() {
        let template = SidcTemplate {
            version: "10".to_string(),
            context: Context::Reality,
            standard_identity: StandardIdentity::HostileFaker,
            symbol_set: SymbolSet::Surface,
            status: Status::PresentFullyCapable,
            hqtfd: Hqtfd::NotApplicable,
            amplifier: Amplifier::Unspecified,
            entity: EntityCode::parse("120204").expect("entity"),
            modifier_one: ModifierCode::parse("00").expect("m1"),
            modifier_two: ModifierCode::parse("00").expect("m2"),
        };
        let sidc = template.to_sidc_string().expect("template should build");
        assert_eq!(sidc, "10-0-6-30-2-0-00-120204-00-00");
    }

    #[test]
    fn deserializes_sidc_template_symbolic_yaml() {
        let yaml = r#"
version: "10"
context: reality
standard_identity: hostile_faker
symbol_set: surface
status: present_fully_capable
hqtfd: not_applicable
amplifier: unspecified
entity: code_120204
modifier_one: code_00
modifier_two: code_00
"#;
        let t: SidcTemplate = serde_yaml::from_str(yaml).expect("yaml");
        assert_eq!(
            t.to_sidc_string().expect("sidc"),
            "10-0-6-30-2-0-00-120204-00-00"
        );
    }

    #[test]
    fn deserializes_legacy_digit_strings_in_yaml() {
        let yaml = r#"
context: reality
standard_identity: hostile_faker
symbol_set: surface
status: present_fully_capable
hqtfd: "0"
amplifier: "00"
entity: "120204"
modifier_one: "00"
modifier_two: "00"
"#;
        let t: SidcTemplate = serde_yaml::from_str(yaml).expect("yaml");
        assert!(t.to_sidc_string().is_ok());
    }

    #[test]
    fn surface_allows_towed_array_amplifiers() {
        assert!(amplifier_is_valid_for_symbol_set(SymbolSet::Surface, "61"));
        assert!(amplifier_is_valid_for_symbol_set(SymbolSet::Subsurface, "62"));
    }

    #[test]
    fn surface_rejects_echelon_amplifier() {
        let template = SidcTemplate {
            version: "10".to_string(),
            context: Context::Reality,
            standard_identity: StandardIdentity::HostileFaker,
            symbol_set: SymbolSet::Surface,
            status: Status::PresentFullyCapable,
            hqtfd: Hqtfd::NotApplicable,
            amplifier: Amplifier::TeamCrew,
            entity: EntityCode::parse("120204").expect("entity"),
            modifier_one: ModifierCode::parse("00").expect("m1"),
            modifier_two: ModifierCode::parse("00").expect("m2"),
        };
        let err = template.to_sidc_string().unwrap_err();
        assert!(
            err.contains("11") && err.contains("Surface") && err.contains("61"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn unit_allows_echelon_amplifier() {
        let template = SidcTemplate {
            version: "10".to_string(),
            context: Context::Reality,
            standard_identity: StandardIdentity::Friend,
            symbol_set: SymbolSet::Unit,
            status: Status::Present,
            hqtfd: Hqtfd::NotApplicable,
            amplifier: Amplifier::BattalionSquadron,
            entity: EntityCode::parse("000000").expect("entity"),
            modifier_one: ModifierCode::parse("00").expect("m1"),
            modifier_two: ModifierCode::parse("00").expect("m2"),
        };
        assert!(template.to_sidc_string().is_ok());
    }
}

