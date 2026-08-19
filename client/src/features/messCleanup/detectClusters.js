const DEFAULT_SPATIAL_THRESHOLD = 180;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const getBounds = (object) => {
  const width = Math.abs((object.size?.width || 0) * (object.scale?.x || 1));
  const height = Math.abs((object.size?.height || 0) * (object.scale?.y || 1));
  const x = object.position?.x || 0;
  const y = object.position?.y || 0;

  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2
  };
};

const distanceBetween = (first, second) => {
  const a = getBounds(first);
  const b = getBounds(second);
  const horizontalGap = Math.max(a.left - b.right, b.left - a.right, 0);
  const verticalGap = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  return Math.hypot(horizontalGap, verticalGap);
};

const isSticky = (object) => object.metadata?.isStickyNote === true;

export const detectSpatialClusters = (objects, threshold = DEFAULT_SPATIAL_THRESHOLD) => {
  const sortedObjects = [...objects].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  const adjacency = new Map(sortedObjects.map((object) => [object.id, new Set()]));

  for (let firstIndex = 0; firstIndex < sortedObjects.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < sortedObjects.length; secondIndex += 1) {
      const first = sortedObjects[firstIndex];
      const second = sortedObjects[secondIndex];
      if (distanceBetween(first, second) <= threshold) {
        adjacency.get(first.id)?.add(second.id);
        adjacency.get(second.id)?.add(first.id);
      }
    }
  }

  const visited = new Set();
  const clusters = [];

  sortedObjects.forEach((object) => {
    if (visited.has(object.id)) return;

    const members = [];
    const queue = [object.id];
    visited.add(object.id);

    while (queue.length > 0) {
      const currentId = queue.shift();
      members.push(currentId);
      adjacency.get(currentId)?.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    const memberObjects = members.map((id) => sortedObjects.find((item) => item.id === id));
    const stickyCount = memberObjects.filter(isSticky).length;
    const evidence = ['spatial-cluster'];
    if (stickyCount >= 2) evidence.push('sticky-note-group');

    clusters.push({
      objectIds: members.sort(),
      evidence,
      strength: stickyCount >= 2 ? 'medium' : 'weak',
      isCandidate: members.length > 1
    });
  });

  return clusters;
};

export const isValidSpatialThreshold = (threshold) => isFiniteNumber(threshold) && threshold >= 0;
