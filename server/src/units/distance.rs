//! Horizontal geodesic distances and length units. Use explicit conversions between feet, meters,
//! nautical miles, and statute miles — do not add values in different units without converting.

/// International foot in meters (exact definition). Matches `client/src/units/length.js`
/// (`METERS_PER_INTERNATIONAL_FOOT`).
pub const INTERNATIONAL_FOOT_IN_METERS: f64 = 0.3048;

/// Nautical mile in meters (exact).
pub const METERS_PER_NAUTICAL_MILE: f64 = 1852.0;

/// International statute mile in meters.
pub const METERS_PER_STATUTE_MILE: f64 = 1609.344;

/// Geodesic distance or horizontal length in meters (sim / WGS84 geodesic convention).
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct Meter(pub f64);

/// Length in international feet.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct Foot(pub f64);

/// Length in nautical miles.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct NauticalMile(pub f64);

/// Length in statute miles.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct StatuteMile(pub f64);

impl Meter {
    #[inline]
    pub const fn new(v: f64) -> Self {
        Self(v)
    }

    /// Construct from a raw meter value at a library/DTO boundary (same as [`Meter::new`]).
    #[inline]
    pub const fn from_raw_meters(v: f64) -> Self {
        Self(v)
    }

    #[inline]
    pub const fn raw(self) -> f64 {
        self.0
    }

    #[inline]
    pub fn clamp(self, min: Self, max: Self) -> Self {
        Self(self.0.clamp(min.0, max.0))
    }
}

impl Foot {
    #[inline]
    pub const fn from_raw_feet(v: f64) -> Self {
        Self(v)
    }

    #[inline]
    pub fn raw(self) -> f64 {
        self.0
    }

    #[inline]
    pub fn to_meter(self) -> Meter {
        Meter(self.0 * INTERNATIONAL_FOOT_IN_METERS)
    }
}

impl NauticalMile {
    #[inline]
    pub const fn new(v: f64) -> Self {
        Self(v)
    }

    #[inline]
    pub fn raw(self) -> f64 {
        self.0
    }

    #[inline]
    pub fn to_meter(self) -> Meter {
        Meter(self.0 * METERS_PER_NAUTICAL_MILE)
    }
}

impl StatuteMile {
    #[inline]
    pub const fn new(v: f64) -> Self {
        Self(v)
    }

    #[inline]
    pub fn raw(self) -> f64 {
        self.0
    }

    #[inline]
    pub fn to_meter(self) -> Meter {
        Meter(self.0 * METERS_PER_STATUTE_MILE)
    }
}

impl Meter {
    #[inline]
    pub fn to_foot(self) -> Foot {
        Foot(self.0 / INTERNATIONAL_FOOT_IN_METERS)
    }

    #[inline]
    pub fn to_nautical_mile(self) -> NauticalMile {
        NauticalMile(self.0 / METERS_PER_NAUTICAL_MILE)
    }

    #[inline]
    pub fn to_statute_mile(self) -> StatuteMile {
        StatuteMile(self.0 / METERS_PER_STATUTE_MILE)
    }
}

impl std::ops::Add for Meter {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        Self(self.0 + rhs.0)
    }
}

impl std::ops::Sub for Meter {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self {
        Self(self.0 - rhs.0)
    }
}

impl std::ops::Neg for Meter {
    type Output = Self;

    fn neg(self) -> Self {
        Self(-self.0)
    }
}

impl std::ops::Mul<f64> for Meter {
    type Output = Self;

    fn mul(self, rhs: f64) -> Self {
        Self(self.0 * rhs)
    }
}

impl std::ops::AddAssign for Meter {
    fn add_assign(&mut self, rhs: Self) {
        self.0 += rhs.0;
    }
}

/// Minimum / maximum orbit and racetrack turn radius accepted by the server (meters).
pub const ORBIT_RADIUS_MIN: Meter = Meter(75.0);
pub const ORBIT_RADIUS_MAX: Meter = Meter(2_000_000.0);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foot_meter_round_trip() {
        let f = Foot::from_raw_feet(3.28084);
        let m = f.to_meter();
        assert!((m.raw() - 1.0).abs() < 1e-3);
        assert!((m.to_foot().raw() - f.raw()).abs() < 1e-3);
    }

    #[test]
    fn nm_and_mi_convert() {
        let nm = NauticalMile::new(1.0);
        assert!((nm.to_meter().raw() - 1852.0).abs() < 1e-9);
        assert!((nm.raw() - 1.0).abs() < 1e-12);
        let mi = StatuteMile::new(1.0);
        assert!((mi.to_meter().raw() - 1609.344).abs() < 1e-9);
        assert!((mi.raw() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn meter_from_raw_and_inverse_nm_mi() {
        let m = Meter::from_raw_meters(1852.0);
        assert!((m.to_nautical_mile().raw() - 1.0).abs() < 1e-12);
        let m2 = Meter::from_raw_meters(1609.344);
        assert!((m2.to_statute_mile().raw() - 1.0).abs() < 1e-9);
    }
}
