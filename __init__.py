import requests
import json
import base64
import io
import numpy as np
from PIL import Image
import torch
import threading
import time

# --- 1. GLOBAL HELPERS (Must be at the top) ---
WEB_DIRECTORY = "./web"

def ensure_tensor(image_input):
    if isinstance(image_input, dict):
        return image_input.get("samples") or image_input.get("image")
    return image_input

def safe_get(url, timeout=2):
    try:
        response = requests.get(url, timeout=timeout)
        if response.status_code == 200:
            return response.json()
    except:
        return None

def tensor_to_base64(image_tensor):
    img_tensor = ensure_tensor(image_tensor)
    if img_tensor is None: return ""
    # ComfyUI tensors are [B, H, W, C], we take first image in batch
    i = 255. * img_tensor[0].cpu().numpy()
    img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()

def base64_to_tensor(base64_str):
    img_data = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(img_data))
    img_array = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(img_array)[None,]

# --- 2. NODE CLASSES ---

from .lora_forge_stack import ForgeLoraStack

from .controlnet_forge_stack import ForgeControlNetStack
            
class ForgeSampler:
    @classmethod
    def INPUT_TYPES(cls):
        ckpts = safe_get("http://127.0.0.1:7860/sdapi/v1/sd-models")
        checkpoints = ["None"] + [c["model_name"] for c in ckpts] if ckpts else ["None"]
        s_data = safe_get("http://127.0.0.1:7860/sdapi/v1/samplers")
        samplers = [s["name"] for s in s_data] if s_data else ["Euler a"]
        sc_data = safe_get("http://127.0.0.1:7860/sdapi/v1/schedulers")
        schedulers = [s["name"] for s in sc_data] if sc_data else ["Normal"]

        return {
            "required": {
                "forge_url": ("STRING", {"default": "http://127.0.0.1:7860"}),
                "checkpoint": (checkpoints,),
                "prompt": ("STRING", {"multiline": True}),
                "negative_prompt": ("STRING", {"multiline": True}),
                "seed": ("INT", {"default": 42, "min": -1, "max": 0xffffffffffffffff}),
                "steps": ("INT", {"default": 20}),
                "cfg_scale": ("FLOAT", {"default": 7.0}),
                "sampler_name": (samplers,),
                "scheduler": (schedulers,),
                "width": ("INT", {"default": 512, "step": 8}),
                "height": ("INT", {"default": 512, "step": 8}),
            },
            "optional": {
                "init_image": ("IMAGE",),
                "denoising_strength": ("FLOAT", {"default": 0.7}),
                "lora_stack": ("LORA_STACK",),
                "cn_stack": ("CN_STACK",),
            }
        }
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "ForgeUI"

    def run(self, forge_url, checkpoint, prompt, negative_prompt, seed, steps, cfg_scale, 
            sampler_name, scheduler, width, height, init_image=None, denoising_strength=0.7, 
            lora_stack=None, cn_stack=None):
        
        # Build final prompt with Loras
        full_prompt = prompt
        if lora_stack:
            for l in lora_stack:
                full_prompt += f" <lora:{l['name']}:{l['strength']}>"

        payload = {
            "prompt": full_prompt,
            "negative_prompt": negative_prompt,
            "steps": steps,
            "cfg_scale": cfg_scale,
            "seed": seed,
            "width": width,
            "height": height,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "alwayson_scripts": {}
        }

        if cn_stack:
            payload["alwayson_scripts"]["ControlNet"] = {"args": cn_stack}

        # Handle img2img
        endpoint = "txt2img"
        if init_image is not None:
            endpoint = "img2img"
            payload["init_images"] = [tensor_to_base64(init_image)]
            payload["denoising_strength"] = denoising_strength

        # Checkpoint override
        if checkpoint != "None":
            payload["override_settings"] = {"sd_model_checkpoint": checkpoint}

        response = requests.post(f"{forge_url}/sdapi/v1/{endpoint}", json=payload)
        result = response.json()
        
        return (base64_to_tensor(result["images"][0]),)

# --- 3. MAPPINGS (The names here MUST match the class names exactly) ---

NODE_CLASS_MAPPINGS = {
    "ForgeLoraStack": ForgeLoraStack,
    "ForgeControlNetStack": ForgeControlNetStack,
    "ForgeSampler": ForgeSampler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ForgeLoraStack": "Forge LoRA Stack",
    "ForgeControlNetStack": "Forge ControlNet Stack",
    "ForgeSampler": "Forge Sampler",
}