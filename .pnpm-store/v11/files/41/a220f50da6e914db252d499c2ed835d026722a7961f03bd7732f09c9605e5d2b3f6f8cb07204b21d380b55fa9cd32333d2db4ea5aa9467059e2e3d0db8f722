import { statsBuffer } from './buffer.mjs';

function clearStatsBuffer() {
    statsBuffer.value = null;
    statsBuffer.addProjectionMetrics = null;
}
function recordStats() {
    if (statsBuffer.value) {
        clearStatsBuffer();
        throw new Error("Stats are already being measured");
    }
    const buffer = statsBuffer;
    buffer.value = {
        layoutProjection: {
            nodes: [],
            calculatedTargetDeltas: [],
            calculatedProjections: [],
        },
    };
    buffer.addProjectionMetrics = (metrics) => {
        const { layoutProjection } = buffer.value;
        layoutProjection.nodes.push(metrics.nodes);
        layoutProjection.calculatedTargetDeltas.push(metrics.calculatedTargetDeltas);
        layoutProjection.calculatedProjections.push(metrics.calculatedProjections);
    };
}

export { recordStats };
//# sourceMappingURL=index.mjs.map
