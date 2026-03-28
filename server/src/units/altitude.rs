//! Vertical position relative to a **datum**. Unit conversions (feet ↔ meters) go through
//! [`crate::earth::feet_to_meters`] / [`crate::earth::meters_to_feet`] so the wire constant stays
//! single-sourced with `METERS_PER_INTERNATIONAL_FOOT`.
//!
//! **Not automatic:** switching datum (e.g. **AGL** ↔ **MSL** ↔ **HAE**) needs geoid, pressure, or
//! terrain elevation at a horizontal location. When those models exist, add distinct marker types
//! (as for [`Hae`]) and **named** conversions only where data allows.

use std::marker::PhantomData;

/// WGS84 height above the reference ellipsoid.
#[derive(Clone, Copy, Debug)]
pub struct Hae;

/// Altitude stored in international feet (matches entity wire `hae_ft`).
#[derive(Clone, Copy, Debug)]
pub struct InternationalFootUnit;

/// Altitude stored in meters.
#[derive(Clone, Copy, Debug)]
pub struct MeterUnit;

/// Altitude tagged by datum `D` and storage unit `U`.
#[derive(Clone, Copy)]
pub struct Altitude<D, U> {
    value: f64,
    _d: PhantomData<D>,
    _u: PhantomData<U>,
}

impl<D, U> Altitude<D, U> {
    #[inline]
    pub fn raw(self) -> f64 {
        self.value
    }
}

impl<D, U> std::fmt::Debug for Altitude<D, U> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Altitude")
            .field("value", &self.value)
            .finish()
    }
}

impl Altitude<Hae, InternationalFootUnit> {
    /// WGS84 HAE from scenario / template wire format (international feet).
    #[inline]
    pub const fn from_wire_feet(ft: f64) -> Self {
        Self {
            value: ft,
            _d: PhantomData,
            _u: PhantomData,
        }
    }

    /// Pure scaling: HAE in feet → HAE in meters (same ellipsoid; uses [`crate::earth::feet_to_meters`]).
    #[inline]
    pub fn to_hae_meters(self) -> Altitude<Hae, MeterUnit> {
        Altitude {
            value: crate::earth::feet_to_meters(self.value),
            _d: PhantomData,
            _u: PhantomData,
        }
    }
}

impl Altitude<Hae, MeterUnit> {
    #[inline]
    pub const fn from_hae_meters(m: f64) -> Self {
        Self {
            value: m,
            _d: PhantomData,
            _u: PhantomData,
        }
    }

    /// Wire / client parity (international feet) via [`crate::earth::meters_to_feet`].
    #[inline]
    pub fn to_wire_feet(self) -> Altitude<Hae, InternationalFootUnit> {
        Altitude {
            value: crate::earth::meters_to_feet(self.value),
            _d: PhantomData,
            _u: PhantomData,
        }
    }
}

/// Map HAE in meters to a horizontal [`super::distance::Meter`] length for geometry (same datum).
#[inline]
pub fn hae_meters_to_distance_meter(a: Altitude<Hae, MeterUnit>) -> super::distance::Meter {
    super::distance::Meter::new(a.raw())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hae_feet_meters_round_trip_loose() {
        let ft = Altitude::<Hae, InternationalFootUnit>::from_wire_feet(100.0);
        let m = ft.to_hae_meters();
        let back = m.to_wire_feet();
        assert!((back.raw() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn hae_meters_to_distance_meter_matches_raw() {
        let m = Altitude::<Hae, MeterUnit>::from_hae_meters(1234.5);
        assert_eq!(hae_meters_to_distance_meter(m).raw(), 1234.5);
    }
}
