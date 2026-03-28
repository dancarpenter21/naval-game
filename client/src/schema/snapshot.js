import { z } from 'zod';

export const LatLonDegSchema = z.object({
  lat_deg: z.number(),
  lon_deg: z.number(),
});

export const HardpointMountSchema = z.object({
  id: z.string(),
  allowed_entity_ids: z.array(z.string()).optional().default([]),
  carried_entity_id: z.string().optional().nullable(),
});

export const CesiumShapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sphere'),
    radius_px: z.number(),
    color: z.string().optional().nullable(),
  }),
  z.object({
    kind: z.literal('box'),
    half_axes_m: z.tuple([z.number(), z.number(), z.number()]),
    color: z.string().optional().nullable(),
  }),
  z.object({
    kind: z.literal('ellipsoid'),
    radii_m: z.tuple([z.number(), z.number(), z.number()]),
    color: z.string().optional().nullable(),
  }),
  z.object({
    kind: z.literal('cylinder'),
    length_m: z.number(),
    radius_m: z.number(),
    color: z.string().optional().nullable(),
  }),
]);

export const SpaceSnapshotSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  fov_half_angle_deg: z.number(),
  footprint_radius_m: z.number(),
  visibility_cap_radius_m: z.number(),
  ground_track_deg: z.array(LatLonDegSchema),
  future_footprint_deg: z.array(LatLonDegSchema),
  field_of_regard_polygon_deg: z.array(LatLonDegSchema).optional().default([]),
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
  /** When set, MapView uses this GLB URL (under `public/`) instead of milsymbol for the globe marker. */
  map_icon_glb_url: z.string().optional().nullable(),
  /** PNG/SVG/JPEG etc. under `public/` (or absolute URL). Used when GLB is absent. */
  map_icon_image_url: z.string().optional().nullable(),
  map_cesium_shape: CesiumShapeSchema.optional().nullable(),
  movable: z.boolean().optional(),
  hide_map_marker: z.boolean().optional(),
  space: SpaceSnapshotSchema.optional().nullable(),
  station_eta_sim_s: z.number().optional().nullable(),
  station_progress: z.number().optional().nullable(),
  display_path_deg: z.array(LatLonDegSchema).optional().nullable(),
  /** Server: cruise | transit_waypoints | orbit | racetrack */
  movement_kind: z.string().optional().nullable(),
  attached_to_id: z.string().optional().nullable(),
  hardpoints: z.array(HardpointMountSchema).optional().nullable(),
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
