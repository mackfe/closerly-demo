# Closerly - OS Inteligente para Real Estate (Demo)

**Closerly** es un Sistema Operativo para agencias inmobiliarias que transforma inventario, CRM y marketing en una infraestructura autónoma de ventas, con un motor de Inteligencia Artificial capaz de calificar leads y agendar citas sin intervención humana.

Este repositorio es una **demo pública** con una selección del código del motor de IA del proyecto.

## Arquitectura de IA (Genkit + Google Gemini)

El sistema usa **Google Genkit** con **Gemini** para orquestar agentes y flujos de IA:

- **`src/ai/genkit.ts`** — Configuración del runtime Genkit con Google AI.
- **`src/ai/closy-agent.ts`** — Agente principal "Closy" que define herramientas para escanear configuración, resolver configuraciones faltantes y gestionar el flujo del negocio inmobiliario.
- **`src/ai/flows/ai-lead-analyzer.ts`** — Analizador de leads con IA: clasifica el tipo de cliente (Buyer/Seller) y sugiere el estado en el pipeline.
- **`src/ai/flows/ai-chat-responder.ts`** — Respuesta inteligente a consultas de clientes en chat.
- **`src/ai/flows/ai-campaign-builder.ts`** — Constructor de campañas de marketing asistido por IA.

## Stack
- **Frontend:** Next.js (App Router), React, TypeScript
- **Backend/BD:** Firebase (Auth, Firestore), multi-tenancy
- **IA:** Google Genkit, Gemini 2.5 Flash, prompts con schemas (Zod)
- **Integraciones:** Meta Marketing API (Ads & Lead Forms), Twilio API (SMS & Telefonía)

## Nota
Repositorio demo: muestra representativa del motor de IA. El proyecto completo es privado.

**Autor:** José Rodríguez (mackfe)
