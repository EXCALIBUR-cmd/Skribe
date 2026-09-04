import { recoverConnectorTopology } from './connectorTopology.js';

export const detectRelationships = (objects) => {
  const relationshipsById = new Map();
  objects.forEach((object) => relationshipsById.set(object.id, []));

  const addRelationship = (sourceId, relationship) => {
    if (!sourceId || !relationshipsById.has(sourceId)) return;
    relationshipsById.get(sourceId).push(relationship);
  };

  const containers = objects.filter((o) => ['shape', 'note'].includes(o.type));

  const getDistanceToBox = (px, py, box) => {
    const dx = Math.max(box.x - px, 0, px - (box.x + box.width));
    const dy = Math.max(box.y - py, 0, py - (box.y + box.height));
    return Math.hypot(dx, dy);
  };

  const getObjectBox = (o) => ({
    x: o.position?.x ?? o.left ?? 0,
    y: o.position?.y ?? o.top ?? 0,
    width: o.size?.width ?? o.width ?? 0,
    height: o.size?.height ?? o.height ?? 0
  });

  objects.forEach((object) => {
    const metadata = object.relationshipMetadata || {};

    if (object.type === 'connector') {
      const topo = recoverConnectorTopology(object, containers);
      object.connectorTopology = topo;
      object.sourceShapeId = topo.sourceShapeId;
      object.targetShapeId = topo.targetShapeId;

      if (!object.relationshipMetadata) object.relationshipMetadata = {};
      object.relationshipMetadata.sourceShapeId = topo.sourceShapeId;
      object.relationshipMetadata.targetShapeId = topo.targetShapeId;

      if (object.connector) {
        object.connector.sourceShapeId = topo.sourceShapeId;
        object.connector.targetShapeId = topo.targetShapeId;
      }
    }

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
