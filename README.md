# Ravensbourne Place — Phase 1 Interactive Site Map

An interactive, self-contained site map of the **Ravensbourne Place** development in
Bromley (Berkeley Group / JTP), built from the Phase 1 hybrid planning application
(Bromley planning ref `a0lTv000003RpUXIA0`).

Open **`index.html`** through any static web server and explore all **578 Phase 1 homes**.

## Features

- **Every home is plotted** on its ground-floor-plan sheet (12 sheets) and on the
  apartment block site plans — 440 houses + 138 apartments across 9 blocks.
- **Hover any home** to see its full schedule data *and* the house-type elevation
  drawing (where available — every Phase 1 unit has one):
  plot number, bedrooms, housetype, occupancy, tenure, design option, parking,
  accessibility, handed, GIA.
- **Colour-coded by number of bedrooms** (1–5 bed) with a legend.
- **Apartment blocks** show their elevation drawing, bed mix and full unit list.
- **Masterplan — All Phases** panel (Development Parcel Plan) shows the Phase 1A / 1B
  parcels in context with the wider outline area reserved for future phases.
- **Search** by plot number, **locate** any plot from the full filterable data table
  (filter by bedrooms, plot type, tenure), pan & zoom.

## About the phases

This is a **hybrid** application: only **Phase 1** is detailed (house-level data and
drawings), so only its homes carry plot-level information and images. The remaining
phases of the ~2,200-home masterplan are **outline** and are represented as parcels on
the Masterplan panel rather than individual homes.

## Files

| File | Description |
|------|-------------|
| `index.html` | The complete single-page app (HTML + CSS + JS, no dependencies). |
| `map_data.json` | Plot schedule, marker positions, panel definitions, bedroom counts, image keys. |
| `map_images.json` | Base64 floor-plan sheets, apartment site plans and the masterplan parcel plan. |
| `map_overview_img.json` | Base64 site key plan used in the sidebar. |
| `unit_images.json` | Base64 house-type and apartment-block elevation crops shown on hover. |

## Data source

All data and drawings are extracted from the published Phase 1 planning documents on the
[Bromley Public Register](https://planningaccess.bromley.gov.uk/) for application
`a0lTv000003RpUXIA0`.
