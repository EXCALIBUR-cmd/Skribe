
import { OPPORTUNITY_TYPES } from './cleanupOpportunities.js';
import { getSemanticType } from './cleanupTypes.js';

const sortStrings = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));

export const resolveCleanupOpportunity = (opportunity, context = {}) => {
  if (!opportunity) return { action: null, rejectedReason: 'Null opportunity' };

  const { objectMap = new Map(), semanticScene = {}, explicitEdges = [] } = context;
  const oppType = opportunity.type;
  const oppIds = opportunity.objectIds || [];

  if (oppType === OPPORTUNITY_TYPES.OVERLAP) {
    if (oppIds.length < 2) {
      return { action: null, rejectedReason: 'Overlap requires at least 2 objects' };
    }

    const [idA, idB] = oppIds;
    const objA = objectMap.get(idA);
    const objB = objectMap.get(idB);

    if (!objA || !objB) {
      return { action: null, rejectedReason: 'Overlap objects missing from model' };
    }

    const semA = getSemanticType(objA);
    const semB = getSemanticType(objB);

    const isConnectedInFlow = explicitEdges.some(
      (e) => (e.srcId === idA && e.tgtId === idB) || (e.srcId === idB && e.tgtId === idA)
    );

    if (isConnectedInFlow && semA === 'shape' && semB === 'shape') {
      const conn = explicitEdges.find(
        (e) => (e.srcId === idA && e.tgtId === idB) || (e.srcId === idB && e.tgtId === idA)
      );
      return {
        action: {
          id: `act_flow_${idA}_${idB}`,
          type: 'cleanFlowchart',
          objectIds: sortStrings([idA, idB]),
          connectorIds: conn ? [conn.connId] : [],
          confidence: opportunity.confidence,
          reason: `Connected flowchart nodes '${idA}' and '${idB}' overlap by ${opportunity.metadata?.overlapRatio ? Math.round(opportunity.metadata.overlapRatio * 100) : 10}%; flowchart leveling separates them along the connector direction.`,
          evidence: [...(opportunity.evidence || []), 'flowchart-separation'],
          layoutBenefit: 'resolves node collision'
        },
        rejectedReason: null
      };
    }

    if ((semA === 'note' || objA.isStickyNote) && (semB === 'note' || objB.isStickyNote)) {
      return {
        action: {
          id: `act_grid_overlap_${idA}_${idB}`,
          type: 'arrangeGrid',
          objectIds: sortStrings([idA, idB]),
          confidence: opportunity.confidence,
          reason: `Sticky notes '${idA}' and '${idB}' collide; arranging in structured layout restores note visibility.`,
          evidence: [...(opportunity.evidence || []), 'note-overlap-resolution'],
          layoutBenefit: 'separates overlapping notes'
        },
        rejectedReason: null
      };
    }

    const isUnassigned = (g) => !g || (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    const sharedGroup = (semanticScene?.groups || []).find(
      (g) => !isUnassigned(g) && Array.isArray(g.objectIds) && g.objectIds.includes(idA) && g.objectIds.includes(idB)
    );

    if (sharedGroup) {
      const candidateShapeIds = sharedGroup.objectIds.filter((id) => {
        const obj = objectMap.get(id);
        if (!obj) return false;
        const sem = getSemanticType(obj);
        return (sem === 'shape' || sem === 'note') && !obj.isSkribeLine && !obj.isStraightLine;
      });

      if (candidateShapeIds.length >= 3) {
        return {
          action: {
            id: `act_space_overlap_${sharedGroup.id}`,
            type: 'equalizeSpacing',
            axis: 'x',
            objectIds: sortStrings(candidateShapeIds),
            confidence: opportunity.confidence,
            reason: `Shapes '${idA}' and '${idB}' collide within group '${sharedGroup.id}'; equalizing spacing distributes them cleanly.`,
            evidence: [...(opportunity.evidence || []), 'sequence-distribution'],
            layoutBenefit: 'eliminates collision in group'
          },
          rejectedReason: null
        };
      }
    }

    return {
      action: null,
      rejectedReason: `No safe supported resolution exists for collision between unrelated objects '${idA}' and '${idB}' without risking unintended full-board recomposition; preserved in place.`
    };
  }

  if (oppType === OPPORTUNITY_TYPES.BROKEN_FLOW) {
    return {
      action: {
        id: `act_flowchart_${oppIds[0]}_1`,
        type: 'cleanFlowchart',
        objectIds: sortStrings(oppIds),
        connectorIds: sortStrings(opportunity.connectorIds || []),
        confidence: opportunity.confidence,
        reason: opportunity.reason || `Flowchart graph with ${oppIds.length} nodes demonstrates topological disorder; hierarchical leveling restores directional clarity.`,
        evidence: opportunity.evidence || ['explicit-connector-topology'],
        layoutBenefit: 'directional flowchart structure'
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.CONNECTOR_CROSSING) {
    if (oppIds.length >= 2) {
      return {
        action: {
          id: `act_flow_cross_${oppIds[0]}`,
          type: 'cleanFlowchart',
          objectIds: sortStrings(oppIds),
          connectorIds: sortStrings(opportunity.connectorIds || []),
          confidence: opportunity.confidence,
          reason: opportunity.reason || `Connector crossing between '${(opportunity.connectorIds || []).join(' and ')}' resolved via planar graph alignment.`,
          evidence: opportunity.evidence || ['connector-crossing-elimination'],
          layoutBenefit: 'eliminates crossing visual clutter'
        },
        rejectedReason: null
      };
    }
    return {
      action: null,
      rejectedReason: 'Connector crossing could not be isolated to a valid node set; preserved in place.'
    };
  }

  if (oppType === OPPORTUNITY_TYPES.MISALIGNMENT) {
    return {
      action: {
        id: `act_align_${oppIds[0]}_${opportunity.axis || 'centerY'}`,
        type: 'align',
        axis: opportunity.axis || 'centerY',
        objectIds: sortStrings(oppIds),
        confidence: opportunity.confidence,
        reason: opportunity.reason,
        evidence: opportunity.evidence || ['co-linear-intent'],
        layoutBenefit: `aligns ${opportunity.axis || 'centerY'} within ${opportunity.metadata?.delta || 15}px delta`
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.UNEVEN_SPACING || oppType === OPPORTUNITY_TYPES.EXCESSIVE_WHITESPACE) {
    return {
      action: {
        id: `act_space_${oppIds[0]}_${opportunity.axis || 'x'}`,
        type: 'equalizeSpacing',
        axis: opportunity.axis || 'x',
        objectIds: sortStrings(oppIds),
        confidence: opportunity.confidence,
        reason: opportunity.reason,
        evidence: opportunity.evidence || ['spacing-inconsistency'],
        layoutBenefit: `consistent ${opportunity.axis === 'y' ? 'vertical' : 'horizontal'} rhythm`
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.DETACHED_TEXT) {
    const [containerId, textId] = oppIds;
    return {
      action: {
        id: `act_attach_${containerId}_${textId}`,
        type: 'attachText',
        objectIds: [containerId, textId],
        confidence: opportunity.confidence,
        reason: opportunity.reason,
        evidence: opportunity.evidence || ['atomic-unit-containment'],
        layoutBenefit: 're-centers detached label'
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.CLUTTERED_CLUSTER) {
    return {
      action: {
        id: `act_grid_${oppIds[0]}`,
        type: 'arrangeGrid',
        objectIds: sortStrings(oppIds),
        confidence: opportunity.confidence,
        reason: opportunity.reason,
        evidence: opportunity.evidence || ['spatial-scannability'],
        layoutBenefit: 'structured grid arrangement'
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE) {
    return {
      action: {
        id: `act_norm_text_${oppIds[0]}`,
        type: 'normalizeText',
        objectIds: oppIds,
        confidence: opportunity.confidence,
        reason: opportunity.reason,
        evidence: opportunity.evidence || ['standalone-text-readability'],
        layoutBenefit: 'horizontal reading orientation'
      },
      rejectedReason: null
    };
  }

  if (oppType === OPPORTUNITY_TYPES.ISOLATED_OUTLIER) {
    return {
      action: null,
      rejectedReason: `Isolated mark '${oppIds[0]}' has no supported safe layout modification; preserved untouched.`
    };
  }

  // Phase 4F.19: Structural Composition Candidates
  if (opportunity.category === 'composition' || opportunity.structureId) {
    const actId = opportunity.id.startsWith('cand_')
      ? opportunity.id.replace(/^cand_/, 'act_')
      : (opportunity.id.startsWith('opp_') ? opportunity.id.replace(/^opp_/, 'act_') : `act_${opportunity.id}`);

    if (oppType === 'flow') {
      if (oppIds.length < 2) {
        return { action: null, rejectedReason: 'Flow composition requires at least 2 nodes' };
      }
      return {
        action: {
          id: actId,
          type: 'cleanFlowchart',
          objectIds: opportunity.orderedNodeIds || sortStrings(oppIds),
          memberIds: opportunity.memberIds || sortStrings(oppIds),
          connectorIds: sortStrings(opportunity.connectorIds || []),
          template: opportunity.template,
          orientation: opportunity.orientation,
          levelAssignment: opportunity.levelAssignment,
          orderedNodeIds: opportunity.orderedNodeIds,
          verifiedEdges: opportunity.verifiedEdges,
          confidence: opportunity.confidence,
          reason: opportunity.reason || `Reorganized flow structure with ${oppIds.length} nodes for clearer directional reading.`,
          evidence: opportunity.evidence || ['structure-aware-flow-composition'],
          layoutBenefit: 'reorganizes flow into clear directional levels'
        },
        rejectedReason: null
      };
    }

    if (oppType === 'cluster') {
      if (oppIds.length < 2) {
        return { action: null, rejectedReason: 'Cluster composition requires at least 2 items' };
      }
      return {
        action: {
          id: actId,
          type: 'arrangeGrid',
          objectIds: sortStrings(oppIds),
          confidence: opportunity.confidence,
          reason: opportunity.reason || `Reorganized ${oppIds.length} related notes into a compact cluster.`,
          evidence: opportunity.evidence || ['structure-aware-cluster-composition'],
          layoutBenefit: 'compact cluster grid arrangement'
        },
        rejectedReason: null
      };
    }

    if (oppType === 'sequence') {
      if (oppIds.length < 2) {
        return { action: null, rejectedReason: 'Sequence composition requires at least 2 items' };
      }
      const axis = opportunity.template === 'sequence_column' ? 'y' : 'x';
      return {
        action: {
          id: actId,
          type: 'equalizeSpacing',
          axis,
          objectIds: sortStrings(oppIds),
          confidence: opportunity.confidence,
          reason: opportunity.reason || `Aligned ${oppIds.length} related nodes into a consistent sequence.`,
          evidence: opportunity.evidence || ['structure-aware-sequence-cadence'],
          layoutBenefit: `consistent ${axis === 'y' ? 'vertical' : 'horizontal'} rhythm`
        },
        rejectedReason: null
      };
    }

    if (oppType === 'annotation') {
      if (oppIds.length < 2) {
        return { action: null, rejectedReason: 'Annotation composition requires parent and note' };
      }
      return {
        action: {
          id: actId,
          type: 'align',
          axis: 'centerY',
          objectIds: sortStrings(oppIds),
          confidence: opportunity.confidence,
          reason: opportunity.reason || `Repositioned annotation near parent shape while preserving connector semantics.`,
          evidence: opportunity.evidence || ['structure-aware-annotation'],
          layoutBenefit: 'repositions annotation near parent'
        },
        rejectedReason: null
      };
    }

    return {
      action: null,
      rejectedReason: `Structure type '${oppType}' is designated for preservation or cannot be safely expressed by supported executor operations.`
    };
  }

  return { action: null, rejectedReason: `Unsupported opportunity type '${oppType}'` };
};

export const resolveCleanupOpportunities = (selectedOpportunities, context = {}) => {
  const actions = [];
  const rejected = [];

  (selectedOpportunities || []).forEach((opp) => {
    const { action, rejectedReason } = resolveCleanupOpportunity(opp, context);
    if (action) {
      actions.push(action);
    } else {
      rejected.push({
        id: opp.id,
        type: opp.type,
        reason: rejectedReason || 'Could not resolve opportunity into a supported safe action'
      });
    }
  });

  return { actions, rejectedOpportunities: rejected };
};
