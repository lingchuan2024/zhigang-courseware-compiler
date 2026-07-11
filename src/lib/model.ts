import { ModelConfig, LearningUnit, EvidenceAtom, MasterNoteUnit } from '../types';
import { generateMasterNotesLocal, parseMasterNotesFromModel } from './notes';
import { sanitizeText } from './utils';

// 构建提示词
function buildNotesPrompt(units: LearningUnit[], evidences: EvidenceAtom[]): string {
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));

  const unitsContext = units.map((unit, idx) => {
    const unitEvidences = unit.evidenceIds
      .map(id => evidenceMap.get(id))
      .filter((e): e is EvidenceAtom => e !== undefined)
      .map(e => `[${e.id}] (P${e.pageNumber}, ${e.type}): ${sanitizeText(e.content)}`)
      .join('\n');

    return `单元 ${idx + 1} (ID: ${unit.id}):
标题: ${unit.title}
目标: ${unit.objective}
相关证据:
${unitEvidences}`;
  }).join('\n\n');

  return `你是一个课件笔记整理专家。请根据提供的课件证据，为每个学习单元生成结构化的母笔记。

重要规则：
1. 每个声明必须引用至少一个有效的evidenceId
2. 只能使用提供的证据内容，不要编造信息
3. 返回严格的JSON格式，不要有其他文字
4. 如果证据不足以生成某个字段，保持该字段为空数组

证据和单元信息：
${unitsContext}

请按以下JSON格式返回：
{
  "units": [
    {
      "unitId": "对应单元的ID",
      "title": "单元标题",
      "objective": "学习目标（1句话）",
      "summary": "单元摘要（2-3句话）",
      "keyClaims": [
        {
          "content": "核心声明内容",
          "evidenceIds": ["引用的evidenceId数组"],
          "importance": "core"
        }
      ],
      "formulas": [
        {
          "content": "公式或定理内容",
          "evidenceIds": ["evidenceId"]
        }
      ],
      "examples": [
        {
          "content": "示例说明",
          "evidenceIds": ["evidenceId"]
        }
      ],
      "procedures": [
        {
          "content": "步骤或流程",
          "evidenceIds": ["evidenceId"]
        }
      ]
    }
  ]
}`;
}

// 调用OpenAI兼容API
export async function callModelForNotes(
  config: ModelConfig,
  units: LearningUnit[],
  evidences: EvidenceAtom[]
): Promise<MasterNoteUnit[]> {
  // 如果没有配置，直接返回本地生成
  if (!config.endpoint || !config.model || !config.apiKey) {
    return generateMasterNotesLocal(units, evidences);
  }

  try {
    const prompt = buildNotesPrompt(units, evidences);

    const endpoint = config.endpoint.replace(/\/$/, '');
    const url = endpoint.endsWith('/chat/completions')
      ? endpoint
      : `${endpoint}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的课件笔记整理助手。必须严格按照用户要求的JSON格式返回，不要添加任何额外说明。所有内容必须基于提供的证据，每个声明都必须引用有效的证据ID。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60000), // 60秒超时
    });

    if (!response.ok) {
      console.warn('Model API call failed:', response.status, response.statusText);
      return generateMasterNotesLocal(units, evidences);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.warn('Invalid model response format');
      return generateMasterNotesLocal(units, evidences);
    }

    const content = data.choices[0].message.content;
    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(content);
    } catch {
      console.warn('Failed to parse model JSON response');
      return generateMasterNotesLocal(units, evidences);
    }

    return parseMasterNotesFromModel(parsedContent, units, evidences);
  } catch (error) {
    console.warn('Model call error, falling back to local generation:', error);
    return generateMasterNotesLocal(units, evidences);
  }
}

// 验证模型配置是否可用
export function validateModelConfig(config: ModelConfig | null): { valid: boolean; message?: string } {
  if (!config) {
    return { valid: false, message: '未配置模型' };
  }
  if (!config.endpoint) {
    return { valid: false, message: '请输入API端点' };
  }
  if (!config.model) {
    return { valid: false, message: '请输入模型名称' };
  }
  if (!config.apiKey) {
    return { valid: false, message: '请输入API Key' };
  }
  try {
    new URL(config.endpoint);
  } catch {
    return { valid: false, message: 'API端点格式无效' };
  }
  return { valid: true };
}
