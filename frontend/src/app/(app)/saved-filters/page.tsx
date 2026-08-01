import ComingSoon from "@/components/shared/ComingSoon";

export default function SavedFiltersPage() {
  return (
    <ComingSoon
      title="Saved Filters"
      description="The FilterPreset table already exists in the database. Column filters in the new Catalogue Manager currently use AG Grid Enterprise's built-in filter panel directly — wiring 'save as preset' to the API is the remaining step."
      features={["Save current column filters as a named preset", "Apply or delete a saved preset in one click"]}
    />
  );
}
