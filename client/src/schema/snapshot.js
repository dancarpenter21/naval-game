import { z } from 'zod';

export const LatLonDegSchema = z.object({
  lat_deg: z.number(),
  lon_deg: z.number(),
});

export const SpaceSnapshotSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  fov_half_angle_deg: z.number(),
  footprint_radius_m: z.number(),
  ground_track_deg: z.array(LatLonDegSchema),
  future_footprint_deg: z.array(LatLonDegSchema),
});

export const EntityDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  allegiance: z.enum(['hostile', 'friendly']),
  lat_deg: z.number(),
  lon_deg: z.number(),
  /** WGS84 height above ellipsoid (international feet). */
  hae_ft: z.number(),
  heading_deg: z.number(),
  sidc: z.string(),
  movable: z.boolean().optional(),
  hide_map_marker: z.boolean().optional(),
  space: SpaceSnapshotSchema.optional().nullable(),
  station_eta_sim_s: z.number().optional().nullable(),
  station_progress: z.number().optional().nullable(),
  display_path_deg: z.array(LatLonDegSchema).optional().nullable(),
});

export const SpaceCoverageEventSchema = z.object({
  kind: z.string(),
  satellite_id: z.string(),
  asset_id: z.string(),
  sim_time_utc: z.string(),
});

export const WorldSnapshotDtoShapeSchema = z.object({
  entities: z.array(z.unknown()),
  sim_elapsed_s: z.number().optional(),
  sim_time_utc: z.string().optional(),
  wall_dt_s: z.number().optional(),
  time_scale: z.number().optional(),
  space_coverage_events: z.array(SpaceCoverageEventSchema).optional(),
});
