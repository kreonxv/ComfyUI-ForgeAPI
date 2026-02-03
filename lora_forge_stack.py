import requests

def safe_get(url, timeout=2):
    try:
        response = requests.get(url, timeout=timeout)
        if response.status_code == 200:
            return response.json()
    except:
        return None

class ForgeLoraStack:
    @classmethod
    def INPUT_TYPES(cls):
        data = safe_get("http://127.0.0.1:7860/sdapi/v1/loras")
        loras = ["None"] + [l["name"] for l in data] if data else ["None"]
        return {
            "required": {
                "forge_url": ("STRING", {"default": "http://127.0.0.1:7860"}),
                "enabled": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "lora_1_name": (loras,),
                "lora_1_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "lora_2_name": (loras,),
                "lora_2_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "lora_3_name": (loras,),
                "lora_3_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "lora_4_name": (loras,),
                "lora_4_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "lora_5_name": (loras,),
                "lora_5_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("LORA_STACK",)
    FUNCTION = "build"
    CATEGORY = "ForgeUI"

    def build(self, forge_url, enabled, **kwargs):
        if not enabled: return ([],)

        stack = []
        loras_dict = {}
        for key, value in kwargs.items():
            if not key.startswith("lora_"): continue
            prefix = key.rsplit("_", 1)[0]
            param = key.rsplit("_", 1)[1]
            if prefix not in loras_dict: loras_dict[prefix] = {}
            loras_dict[prefix][param] = value

        for l in loras_dict.values():
            if l.get("name") != "None":
                stack.append({"name": l["name"], "strength": float(l.get("strength", 1.0))})

        return (stack,)
