-- Q6. Records with facts from a non-commercial (CC BY-NC) source, which any reuse
-- must keep non-commercial and share-alike.
WITH derived AS (
  SELECT "Item_id" AS record, "derivedFrom_id" AS source FROM "Item_derivedFrom"
  UNION ALL SELECT "Recipe_id", "derivedFrom_id" FROM "Recipe_derivedFrom"
  UNION ALL SELECT "Building_id", "derivedFrom_id" FROM "Building_derivedFrom"
  UNION ALL SELECT "Schematic_id", "derivedFrom_id" FROM "Schematic_derivedFrom"
  UNION ALL SELECT "ResourceNode_id", "derivedFrom_id" FROM "ResourceNode_derivedFrom"
  UNION ALL SELECT "Collectible_id", "derivedFrom_id" FROM "Collectible_derivedFrom"
)
SELECT d.record, d.source, s.licence
FROM derived d
JOIN "Source" s ON s.id = d.source
WHERE s.licence LIKE '%NC%'
ORDER BY d.record, d.source;
