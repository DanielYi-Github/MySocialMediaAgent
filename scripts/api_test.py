import base64
import requests
import os

# ============= 多供應商配置區 =============
class LLMConfig:
    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "openai")
        self.protocol = os.getenv("LLM_PROTOCOL", self._default_protocol())
        self.base_url = os.getenv("LLM_BASE_URL", self._default_base_url())
        self.api_key = os.getenv("LLM_API_KEY", "")
        self.model = os.getenv("LLM_MODEL", self._default_model())

    def _default_protocol(self):
        return "anthropic" if self.provider == "anthropic" else "openai"

    def _default_base_url(self):
        defaults = {
            "openai": "https://api.openai.com/v1",
            "anthropic": "https://api.anthropic.com/v1",
            "nvidia": "https://integrate.api.nvidia.com/v1",
            "ollama": "http://localhost:11434/v1",
        }
        return defaults.get(self.provider, "https://api.openai.com/v1")

    def _default_model(self):
        defaults = {
            "openai": "gpt-4o",
            "anthropic": "claude-3-7-sonnet-latest",
            "nvidia": "meta/llama-3.1-70b-instruct",
            "ollama": "llama3.1",
        }
        return defaults.get(self.provider, "gpt-4o")

def generate_social_media_draft(image_path, config, user_context=""):
    base64_image = encode_image(image_path)
    system_prompt = "你是一個社群媒體導師。請分析圖片並輸出 JSON 格式的文案。"

    try:
        if config.protocol == "anthropic":
            headers = {
                "Content-Type": "application/json",
                "x-api-key": config.api_key,
                "anthropic-version": "2023-06-01",
            }
            payload = {
                "model": config.model,
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"內容描述: {user_context}"},
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": base64_image,
                                },
                            },
                        ],
                    }
                ],
            }
            response = requests.post(f"{config.base_url}/messages", headers=headers, json=payload, timeout=30)
        else:
            headers = {"Content-Type": "application/json"}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"

            payload = {
                "model": config.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"內容描述: {user_context}"},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}},
                        ],
                    },
                ],
                "response_format": {"type": "json_object"},
            }
            response = requests.post(f"{config.base_url}/chat/completions", headers=headers, json=payload, timeout=30)

        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": "Connection Failed", "details": str(e)}

if __name__ == "__main__":
    print("🚀 啟動多功能 API 通訊測試...")
    my_config = LLMConfig()

    print(
        f"📡 Provider: {my_config.provider} | Protocol: {my_config.protocol} | "
        f"URL: {my_config.base_url} | Model: {my_config.model}"
    )
    print("💡 透過 LLM_PROVIDER / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 調整連線。")
