// AUTH-004B - the one place a duplicate cloud-project NAME is checked
// before a new UUID is ever created. Shared by every path that can
// create a new cloud project (StrategiesModal's Save tab - both the
// first-import case and "Save as New" - and the switcher's "Import
// Local Project into Account" action) so there is exactly one behavior
// to reason about, not three near-duplicates that could drift apart
// (which is how AUTH-004's original gap happened: Save as New created
// rows unconditionally, with no name check at all).
//
// This is advisory only (requirement 5: a matching name is NEVER
// permission to overwrite another strategy) - it only ever returns a
// (possibly renamed) name to create under, or null to abort. It never
// looks up or returns an existing project's id/updatedAt, so there is
// no code path here that could accidentally route into an UPDATE of a
// different project.
export function resolveUniqueCloudName(desiredName, existingCloudProjects, { promptFn = window.prompt, t } = {}) {
  const trimmed = (desiredName || '').trim();
  if (!trimmed) return null;
  if (!existingCloudProjects.some((p) => p.name === trimmed)) return trimmed;

  const chosen = promptFn(t ? t('cloud_import_name_conflict') : 'A cloud project with this name already exists. Choose a different name.', `${trimmed} (2)`);
  if (!chosen || !chosen.trim()) return null;
  return chosen.trim();
}
