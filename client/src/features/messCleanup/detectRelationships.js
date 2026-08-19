export const detectRelationships = (objects) => {
  const relationshipsById = new Map();
  objects.forEach((object) => relationshipsById.set(object.id, []));

  const addRelationship = (sourceId, relationship) => {
    if (!sourceId || !relationshipsById.has(sourceId)) return;
    relationshipsById.get(sourceId).push(relationship);
  };

  objects.forEach((object) => {
    const metadata = object.relationshipMetadata || {};
    if (metadata.attachedTextId) {
      addRelationship(object.id, { type: 'contains_text', targetId: metadata.attachedTextId });
    }
    if (metadata.parentShapeId) {
      addRelationship(object.id, { type: 'contained_by', targetId: metadata.parentShapeId });
    }
    if (metadata.sourceShapeId) {
      addRelationship(object.id, { type: 'connects_from', targetId: metadata.sourceShapeId });
    }
    if (metadata.targetShapeId) {
      addRelationship(object.id, { type: 'connects_to', targetId: metadata.targetShapeId });
    }
  });

  const linkedGroups = new Map();
  objects.forEach((object) => {
    if (!object.elementId) return;
    if (!linkedGroups.has(object.elementId)) linkedGroups.set(object.elementId, []);
    linkedGroups.get(object.elementId).push(object.id);
  });

  linkedGroups.forEach((objectIds) => {
    if (objectIds.length < 2) return;
    objectIds.forEach((objectId) => {
      objectIds
        .filter((targetId) => targetId !== objectId)
        .forEach((targetId) => addRelationship(objectId, { type: 'shared_element', targetId }));
    });
  });

  return objects.map((object) => ({
    ...object,
    relationships: relationshipsById.get(object.id) || []
  }));
};
