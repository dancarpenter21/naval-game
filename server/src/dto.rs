use serde::{Deserialize, Serialize};

use crate::ecs::Allegiance;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerTeamDto {
    Blue,
    Red,
    White,
}

// Socket payload DTOs shared by server handlers and emitted events.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatLonDegDto {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceSnapshotDto {
    pub line1: String,
    pub line2: String,
    pub fov_half_angle_deg: f64,
    pub footprint_radius_m: f64,
    pub ground_track_deg: Vec<LatLonDegDto>,
    pub future_footprint_deg: Vec<LatLonDegDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceCoverageEventDto {
    pub kind: String,
    pub satellite_id: String,
    pub asset_id: String,
    pub sim_time_utc: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntitySnapshotDto {
    pub id: String,
    pub name: String,
    pub allegiance: Allegiance,
    pub lat_deg: f64,
    pub lon_deg: f64,
    /// Height above WGS84 ellipsoid (international feet).
    pub hae_ft: f64,
    pub heading_deg: f64,
    pub sidc: String,
    /// False if the entity has no `movement` component (cannot receive movement orders).
    pub movable: bool,
    /// When true, map does not draw a position marker (e.g. space assets).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hide_map_marker: bool,
    /// Simulated seconds until the entity is on its assigned station (orbit/racetrack), if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_eta_sim_s: Option<f64>,
    /// Progress [0, 1] along the issued path toward station (requires `movement_path_total_m` on server).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_progress: Option<f64>,
    /// Full planned path for map overlay (current position → waypoints → station).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_path_deg: Option<Vec<LatLonDegDto>>,
    /// TLE / footprint / ground track when this entity is a space asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space: Option<SpaceSnapshotDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldSnapshotDto {
    pub entities: Vec<EntitySnapshotDto>,
    /// Simulated seconds since session start (server authority).
    pub sim_elapsed_s: f64,
    /// Exercise clock UTC (session start + sim_elapsed).
    pub sim_time_utc: String,
    /// Wall seconds between server ticks.
    pub wall_dt_s: f64,
    /// Sim seconds per wall second (1 = real time; max 64×).
    pub time_scale: f64,
    /// Satellite coverage enter/leave since last snapshot (empty most ticks).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub space_coverage_events: Vec<SpaceCoverageEventDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPublicDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionParticipantDto {
    pub id: String,
    pub name: String,
    pub player_team: PlayerTeamDto,
    /// Display name for this connection (OS user / env / client-provided).
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomPlayerDto {
    pub socket_id: String,
    pub display_name: String,
    pub player_team: PlayerTeamDto,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayersListDto {
    pub players: Vec<RoomPlayerDto>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatScopeDto {
    #[default]
    All,
    Team,
    /// White cell + red team (white cell senders only).
    WhiteRed,
    /// White cell + blue team (white cell senders only).
    WhiteBlue,
    /// Red or blue only: same team + all white cell players (reach white).
    TeamWhite,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessageDto {
    pub from: String,
    pub text: String,
    pub scope: ChatScopeDto,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionsListDto {
    pub sessions: Vec<SessionPublicDto>,
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
pub struct CreateSessionDto {
    pub name: String,
    /// Which scenario file (`stem` of `config/scenarios/<id>.yaml`). Defaults to first scenario if omitted.
    #[serde(default)]
    pub scenario_id: Option<String>,
    /// Client display name (e.g. OS user via `VITE_PLAYER_NAME`).
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct JoinSessionDto {
    pub id: String,
    pub team: PlayerTeamDto,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct StopSessionDto {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct LeaveSessionDto {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotRequestDto {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct SetTimeScaleDto {
    pub session_id: String,
    pub time_scale: f64,
}

#[derive(Debug, Deserialize)]
pub struct ChatSendDto {
    pub session_id: String,
    pub text: String,
    #[serde(default)]
    pub scope: ChatScopeDto,
}

#[derive(Debug, Deserialize)]
pub struct PlayersListRequestDto {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct WaypointDto {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

/// Client issues a movement order for a controllable unit (`movable: true` in snapshots).
#[derive(Debug, Deserialize)]
pub struct IssueMovementOrderDto {
    pub session_id: String,
    pub entity_id: String,
    /// Intermediate fixes (0–n), visited in order before the terminal station.
    #[serde(default)]
    pub waypoints: Vec<WaypointDto>,
    #[serde(flatten)]
    pub order: MovementOrderDto,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MovementOrderDto {
    Orbit {
        center_lat_deg: f64,
        center_lon_deg: f64,
        radius_m: f64,
        clockwise: bool,
    },
    Racetrack {
        point_a_lat_deg: f64,
        point_a_lon_deg: f64,
        point_b_lat_deg: f64,
        point_b_lon_deg: f64,
        orbit_distance_m: f64,
        /// When true, loop direction is clockwise (north-up view). Default false (CCW).
        #[serde(default)]
        racetrack_clockwise: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorDto {
    pub message: String,
}

