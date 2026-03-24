//! Authoritative simulation timing (server-side).
//!
//! - **Wall clock**: fixed tick interval from `SIM_TICK_HZ` (default **16 Hz**).
//! - **Simulation clock**: advances by `wall_dt_s * time_scale` each tick (scale capped at **64×**).
//! - **Integration**: kinematics use fixed substeps (`MAX_SIM_SUBSTEP_S`) so large sim steps
//!   (high time scale) do not skip distance in one integration leap.

use std::env;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use tracing::warn;

use crate::dto::{EntitySnapshotDto, SpaceCoverageEventDto, WorldSnapshotDto};

/// Environment variable: simulation wall-clock rate in Hz (ticks per second).
pub const ENV_SIM_TICK_HZ: &str = "SIM_TICK_HZ";

/// Default tick rate when `SIM_TICK_HZ` is unset or invalid (`2^4` Hz).
pub const DEFAULT_SIM_TICK_HZ: f64 = 16.0;

/// Allowed range (`2^0` … `2^6` Hz) so limits stay on powers of two.
pub const MIN_SIM_TICK_HZ: f64 = 1.0;
pub const MAX_SIM_TICK_HZ: f64 = 64.0;

/// Max simulated seconds per integration substep (fidelity vs cost).
pub const MAX_SIM_SUBSTEP_S: f64 = 1.0;

/// Min simulation rate vs wall clock (`2^-3`× = ⅛×).
pub const MIN_TIME_SCALE: f64 = 0.125;
/// Max simulation rate vs wall clock (`2^6`×).
pub const MAX_TIME_SCALE: f64 = 64.0;

/// SI definition: 1 international knot = 1 nautical mile per hour = 1852 m / 3600 s.
pub const KNOTS_TO_MPS: f64 = 1852.0 / 3600.0;

/// Resolved wall-clock tick configuration (shared by all game sessions).
#[derive(Debug, Clone)]
pub struct SimWallClockConfig {
    /// Effective tick rate (Hz).
    pub hz: f64,
    /// Wall seconds between ticks (`1.0 / hz`).
    pub dt_s: f64,
}

impl SimWallClockConfig {
    /// Read `SIM_TICK_HZ`; clamp to [`MIN_SIM_TICK_HZ`, `MAX_SIM_TICK_HZ`]; default **16** Hz.
    pub fn from_env() -> Self {
        let raw = env::var(ENV_SIM_TICK_HZ).ok();
        let mut hz = DEFAULT_SIM_TICK_HZ;
        if let Some(ref s) = raw {
            let t = s.trim();
            if t.is_empty() {
                warn!(
                    "{} is empty; using default {} Hz",
                    ENV_SIM_TICK_HZ,
                    DEFAULT_SIM_TICK_HZ
                );
            } else if let Ok(v) = t.parse::<f64>() {
                if v < MIN_SIM_TICK_HZ || v > MAX_SIM_TICK_HZ {
                    warn!(
                        "{}={} out of range; using clamped value [{}, {}] Hz",
                        ENV_SIM_TICK_HZ,
                        v,
                        MIN_SIM_TICK_HZ,
                        MAX_SIM_TICK_HZ
                    );
                }
                hz = v.clamp(MIN_SIM_TICK_HZ, MAX_SIM_TICK_HZ);
            } else {
                warn!(
                    "Invalid {}={:?}; using default {} Hz",
                    ENV_SIM_TICK_HZ,
                    s,
                    DEFAULT_SIM_TICK_HZ
                );
            }
        }
        let dt_s = 1.0 / hz;
        Self { hz, dt_s }
    }
}

#[derive(Debug, Clone)]
pub struct SimTimingState {
    /// Total simulated seconds since session start (authoritative).
    pub sim_elapsed_s: f64,
    /// Simulation rate: simulated seconds advanced per wall second (1 = real time).
    pub time_scale: f64,
    /// Exercise clock anchor: `sim_time_utc` = this + sim_elapsed wall-clock style offset.
    pub session_start_utc: DateTime<Utc>,
    /// Wall seconds between ticks (matches server `SimWallClockConfig::dt_s`).
    pub wall_dt_s: f64,
}

impl SimTimingState {
    pub fn new_now(wall_dt_s: f64) -> Self {
        Self {
            sim_elapsed_s: 0.0,
            time_scale: 1.0,
            session_start_utc: Utc::now(),
            wall_dt_s,
        }
    }

    #[inline]
    pub fn clamp_time_scale(x: f64) -> f64 {
        x.clamp(MIN_TIME_SCALE, MAX_TIME_SCALE)
    }

    /// Exercise clock in UTC for UI (scenario start aligned to session creation time).
    pub fn sim_time_rfc3339(&self) -> String {
        let delta = std::time::Duration::from_secs_f64(self.sim_elapsed_s);
        let ch = ChronoDuration::from_std(delta).unwrap_or_else(|_| ChronoDuration::zero());
        (self.session_start_utc + ch).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    pub fn to_world_snapshot(
        &self,
        entities: Vec<EntitySnapshotDto>,
        space_coverage_events: Vec<SpaceCoverageEventDto>,
    ) -> WorldSnapshotDto {
        WorldSnapshotDto {
            entities,
            sim_elapsed_s: self.sim_elapsed_s,
            sim_time_utc: self.sim_time_rfc3339(),
            wall_dt_s: self.wall_dt_s,
            time_scale: self.time_scale,
            space_coverage_events,
        }
    }
}
