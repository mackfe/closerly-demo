'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { LEAD_STATUS } from '@/lib/constants/leads';

const AILeadAnalyzerInputSchema = z.object({
  leadName: z.string(),
  chatHistory: z.string(),
});

const AILeadAnalyzerOutputSchema = z.object({
  leadType: z.enum(['Buyer', 'Seller', 'Unknown']).describe('¿Busca comprar o vender?'),
  suggestedStatus: z.enum([
    LEAD_STATUS.TO_CONTACT, 
    LEAD_STATUS.CONTACTED, 
    LEAD_STATUS.CONVERSATION, 
    LEAD_STATUS.APPOINTMENT, 
    LEAD_STATUS.HOT_LEAD, 
    LEAD_STATUS.CLOSING_PROCESS, 
    LEAD_STATUS.LOST, 
    LEAD_STATUS.QUARANTINE
  ]).describe('Estatus sugerido.'),
  buyerPersona: z.string().describe('Ej. "Familia buscando 1ra casa", "Inversor W2", "Comprador ITIN".'),
  propertyValue: z.number().describe('Presupuesto o valor de venta detectado.'),
  
  // CAMPOS FINANCIEROS AVANZADOS
  incomeType: z.enum(['W2', '1099 / Self-Employed', 'Cash', 'Mixto', 'Desconocido']).describe('¿Cómo gana su dinero?'),
  legalStatus: z.enum(['SSN', 'ITIN', 'Desconocido']).describe('¿Seguro Social o ITIN?'),
  hasCoBorrower: z.enum(['Sí', 'No', 'Desconocido']).describe('¿Comprará con pareja/familiar?'),
  downPaymentAvailable: z.string().describe('Dinero ahorrado para Down Payment.'),
  
  // NUEVO: EXTRACCIÓN DEL TIPO DE PROPIEDAD
  desiredProperty: z.string().describe('¿Qué tipo de propiedad busca exactamente? (Ej. "Casa de 3 habs en Orlando", "Condo con piscina", o "Desconocido" si no lo ha dicho).'),
  
  // NUEVO: MEMORIA A CORTO PLAZO Y AUTONOMÍA (Fase 2)
  lastAction: z.string().describe('Resumen de lo último que pasó o la última acción realizada/detectada (ej. "El lead canceló la llamada", "El lead solicitó ser contactado por la tarde").'),
  nextAction: z.object({
    description: z.string().describe('La descripción de la próxima acción recomendada a realizar (ej. "Llamar al cliente", "Enviar opciones de casas"). Si no hay acción futura recomendada o clara, poner una cadena vacía.'),
    scheduledTime: z.string().describe('Fecha/hora recomendada para realizar la próxima acción en formato ISO 8601 si detecta que el cliente pidió ser contactado después. Poner una cadena vacía si no hay fecha/hora sugerida o acordada.')
  }).describe('Detalle de la próxima acción sugerida y cuándo realizarla.'),

  aiSummary: z.string().describe('Resumen ejecutivo de 3 líneas mencionando fortalezas, debilidades financieras y qué busca comprar.')
});

export const aiLeadAnalyzerFlow = ai.defineFlow(
  {
    name: 'aiLeadAnalyzerFlow',
    inputSchema: AILeadAnalyzerInputSchema,
    outputSchema: AILeadAnalyzerOutputSchema,
  },
  async (input: z.infer<typeof AILeadAnalyzerInputSchema>) => {
    const systemPrompt = `
Eres un analista de datos inmobiliarios de élite (Nivel Master Setter). 
Lee la transcripción del chat y extrae la información financiera clave, el TIPO DE PROPIEDAD EXACTA QUE BUSCA EL CLIENTE, y deduce las acciones recientes y futuras.
Presta atención si mencionan "ITIN", "1099", "mi esposo y yo" (Co-borrower) o ahorros.
Si el cliente accede a una cita o muestra un interés altísimo en agendar, marca el status como "${LEAD_STATUS.APPOINTMENT}".
Deduce la última acción ('lastAction') basándote en la última interacción del historial del chat.
Si el cliente pidió explícitamente ser contactado después, en una fecha, hora o momento futuro, extrae y programa la próxima acción ('nextAction') indicando la descripción y la fecha/hora en formato ISO 8601 (por ejemplo, convirtiendo expresiones como "mañana a las 3pm" o "el próximo lunes" a una fecha ISO real considerando que hoy es ${new Date().toISOString()}). Si no hay una fecha futura solicitada, deja el campo scheduledTime como cadena vacía.
Si faltan datos, marca como "Desconocido" o cadena vacía según corresponda.
`;

    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      system: systemPrompt,
      prompt: `Transcripción del Chat para ${input.leadName}:\n${input.chatHistory}`,
      output: { schema: AILeadAnalyzerOutputSchema }
    });

    return output!;
  }
);
