/**
 * RDF view of an Open Factory Plan, via the LinkML-generated JSON-LD context
 * (`model/generated/ofp.context.jsonld`). Items, recipes and buildings become
 * the same `fgd:` IRIs as in the game graph, so one SPARQL query can join a
 * plan with game data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jsonld from 'jsonld';
import { DATA_NS } from '../ns.ts';
import type { Plan } from './validate.ts';

const MODEL_DIR = join(import.meta.dirname, '..', '..', 'model', 'generated');

/**
 * JSON-LD for a structurally valid plan. Factory IDs are local to the plan, so
 * they become IRIs under `planIri` (e.g. `<planIri>/factory/steel-mill`).
 */
export function planToJsonLd(plan: Plan, planIri: string): object {
  const context = JSON.parse(readFileSync(join(MODEL_DIR, 'ofp.context.jsonld'), 'utf8'))[
    '@context'
  ];
  const factoryIri = (id: string) => `${planIri}/factory/${encodeURIComponent(id)}`;
  const rates = (type: string, list: object[] = []) => list.map((x) => ({ '@type': type, ...x }));
  return {
    '@context': [context, { '@base': DATA_NS }],
    '@id': planIri,
    '@type': 'Plan',
    ...plan,
    ...(plan.tool ? { tool: { '@type': 'Tool', ...plan.tool } } : {}),
    factories: plan.factories.map((f) => ({
      '@type': 'Factory',
      ...f,
      factoryId: factoryIri(f.factoryId),
      ...(f.location ? { location: { '@type': 'Location', ...f.location } } : {}),
      outputs: rates('ItemRate', f.outputs),
      inputs: (f.inputs ?? []).map((i) => ({
        '@type': 'FactoryInput',
        ...i,
        ...(i.fromFactory ? { fromFactory: factoryIri(i.fromFactory) } : {}),
      })),
      lines: rates('ProductionLine', f.lines),
    })),
  };
}

export async function planToNQuads(plan: Plan, planIri: string): Promise<string> {
  return (await jsonld.toRDF(planToJsonLd(plan, planIri) as jsonld.JsonLdDocument, {
    format: 'application/n-quads',
  })) as unknown as string;
}
