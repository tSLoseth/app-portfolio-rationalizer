import type { System } from '../model/types';

/** Integration graph. An edge X → Y means X depends on Y (Y is in X.integrations). */
export interface IntegrationGraph {
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
}

export function buildGraph(systems: System[]): IntegrationGraph {
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const s of systems) {
    dependencies.set(s.id, [...s.integrations]);
    if (!dependents.has(s.id)) dependents.set(s.id, []);
    for (const d of s.integrations) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d)!.push(s.id);
    }
  }
  return { dependencies, dependents };
}

/** Inbound + outbound integrations. */
export function degree(g: IntegrationGraph, id: string): number {
  return (g.dependencies.get(id)?.length ?? 0) + (g.dependents.get(id)?.length ?? 0);
}

/** Tarjan's strongly connected components with more than one node, deterministic by id. */
export function stronglyConnected(nodes: string[], edges: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of [...(edges.get(v) ?? [])].sort()) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const n of [...nodes].sort()) if (!idx.has(n)) visit(n);
  return out.sort((x, y) => x[0]!.localeCompare(y[0]!));
}

/**
 * Kahn's algorithm, dependencies before dependents, ties broken by id.
 * Throws if the graph still contains a cycle.
 */
export function topologicalOrder(nodes: string[], edges: Map<string, string[]>): string[] {
  const nodeSet = new Set(nodes);
  const remaining = new Map<string, number>();
  const reverse = new Map<string, string[]>();
  for (const n of nodes) {
    const deps = (edges.get(n) ?? []).filter((d) => nodeSet.has(d));
    remaining.set(n, deps.length);
    for (const d of deps) reverse.set(d, [...(reverse.get(d) ?? []), n]);
  }
  const ready = nodes.filter((n) => remaining.get(n) === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const m of reverse.get(n) ?? []) {
      const left = remaining.get(m)! - 1;
      remaining.set(m, left);
      if (left === 0) {
        ready.push(m);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('topologicalOrder: graph has a cycle');
  return order;
}
