use serde::{Deserialize, Serialize};

use crate::ecs::Allegiance;

// Socket payload DTOs shared by server handlers and emitted events.

#[derive(Debug, Clone, Serialize)]
pub struct ShipSnapshotDto {
    pub id: String,
    pub name: String,
    pub allegiance: Allegiance,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub hae_m: f64,
    pub heading_deg: f64,
    pub sidc: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldSnapshotDto {
    pub ships: Vec<ShipSnapshotDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPublic {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionsListDto {
    pub sessions: Vec<SessionPublic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioSideEntityDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioSummaryDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub win_conditions: String,
    pub red: Vec<ScenarioSideEntityDto>,
    pub blue: Vec<ScenarioSideEntityDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenariosListDto {
    pub scenarios: Vec<ScenarioSummaryDto>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionData {
    pub name: String,
    /// Which scenario file (`stem` of `config/scenarios/<id>.yaml`). Defaults to first scenario if omitted.
    #[serde(default)]
    pub scenario_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JoinSessionData {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct StopSessionData {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotRequestData {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorDto {
    pub message: String,
}

