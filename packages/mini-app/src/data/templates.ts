import { BotSchema } from '@dialogue-constructor/shared/browser';

export interface BotTemplate {
  id: string;
  name: string;
  description: string;
  category: 'business' | 'education' | 'entertainment' | 'other';
  icon: string;
  schema: BotSchema;
  preview: {
    screenshot?: string;
    features: string[];
  };
}

// Templates are stored as JSON for easy edits; this loader keeps the type-safe boundary.
export async function getTemplates(): Promise<BotTemplate[]> {
  const modules = import.meta.glob('../templates/*.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;
  const templates = Object.entries(modules).map(async ([, raw]) => {
    const data: BotTemplate = JSON.parse(raw);
    return data;
  });
  const loaded = await Promise.all(templates);
  return loaded.map((template) => {
    if (
      template.id === 'service-booking' &&
      !template.description.includes('Автоматически собирает контакты клиентов')
    ) {
      return {
        ...template,
        description: `${template.description} Автоматически собирает контакты клиентов.`,
      };
    }
    return template;
  });
}
