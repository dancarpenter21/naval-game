//! RF power in logarithmic (dBm) and linear watts. Decibel values are **not** a vector space: use
//! [`Dbm::combine_linear`] for uncorrelated power sums, not [`std::ops::Add`] on [`Dbm`].

/// Power in watts (linear).
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct PowerWatts(pub f64);

/// Power relative to 1 mW (dBm).
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct Dbm(pub f64);

impl PowerWatts {
    #[inline]
    pub const fn new(w: f64) -> Self {
        Self(w)
    }

    #[inline]
    pub fn raw(self) -> f64 {
        self.0
    }

    #[inline]
    pub fn to_dbm(self) -> Dbm {
        Dbm(10.0 * (self.0.max(1e-30)).log10() + 30.0)
    }
}

impl Dbm {
    #[inline]
    pub const fn new(db: f64) -> Self {
        Self(db)
    }

    #[inline]
    pub fn raw(self) -> f64 {
        self.0
    }

    /// Linear power in watts.
    #[inline]
    pub fn to_watts(self) -> PowerWatts {
        PowerWatts(10_f64.powf((self.0 - 30.0) / 10.0))
    }

    /// Combine two **uncorrelated** powers: convert to linear, add, convert back to dBm.
    #[inline]
    pub fn combine_linear(self, other: Self) -> Self {
        let p = self.to_watts().raw() + other.to_watts().raw();
        PowerWatts(p).to_dbm()
    }
}

impl std::ops::Add for PowerWatts {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        Self(self.0 + rhs.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_mw_is_zero_dbm() {
        let p = PowerWatts::new(1e-3);
        assert!((p.to_dbm().raw() - 0.0).abs() < 1e-9);
    }

    #[test]
    fn combine_linear_uncorrelated() {
        let a = Dbm::new(0.0);
        let b = Dbm::new(0.0);
        let c = a.combine_linear(b);
        assert!((c.raw() - 3.0102999566398115).abs() < 1e-6);
    }

    #[test]
    fn linear_watts_add() {
        assert_eq!(
            (PowerWatts::new(2.0) + PowerWatts::new(3.0)).raw(),
            5.0
        );
    }
}
