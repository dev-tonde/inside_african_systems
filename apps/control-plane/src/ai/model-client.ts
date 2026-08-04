export type JsonGenerationRequest = {
  system: string;
  user: string;
  schemaName: string;
};

export interface ModelClient {
  generateJson(request: JsonGenerationRequest): Promise<unknown>;
}

export const createWorkersAiClient = (ai: Ai): ModelClient => ({
  async generateJson(request) {
    try {
      const result = await ai.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [
          {role: "system", content: request.system},
          {role: "user", content: request.user},
        ],
        response_format: {type: "json_object"},
        max_tokens: 350,
        temperature: 0,
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("response" in result) ||
        typeof result.response !== "string"
      ) {
        throw new Error("invalid response");
      }
      return JSON.parse(result.response) as unknown;
    } catch {
      throw new Error("Workers AI generation failed");
    }
  },
});
