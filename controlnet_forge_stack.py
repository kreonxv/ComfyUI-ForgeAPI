import requests
import base64
import io
import numpy as np
from PIL import Image
import torch

def safe_get(url, timeout=2):
    try:
        response = requests.get(url, timeout=timeout)
        if response.status_code == 200:
            return response.json()
    except:
        return None

def ensure_tensor(image_input):
    if isinstance(image_input, dict):
        return image_input.get("samples") or image_input.get("image")
    return image_input

def tensor_to_base64(image_tensor):
    img_tensor = ensure_tensor(image_tensor)
    if img_tensor is None: return ""
    i = 255. * img_tensor[0].cpu().numpy()
    img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()

def process_controlnet_image(image_tensor, preprocessor, resolution, threshold_a, threshold_b, forge_url):
    """Process image through ControlNet preprocessor and return as tensor"""
    try:
        # Convert tensor to base64
        img_b64 = tensor_to_base64(image_tensor)
        
        # Call ControlNet detect API
        payload = {
            "controlnet_module": preprocessor,
            "controlnet_input_images": [img_b64],
            "controlnet_processor_res": resolution,
            "controlnet_threshold_a": threshold_a,
            "controlnet_threshold_b": threshold_b,
        }
        
        response = requests.post(f"{forge_url}/controlnet/detect", json=payload, timeout=30)
        if response.status_code == 200:
            result = response.json()
            if result and "images" in result and len(result["images"]) > 0:
                # Convert base64 back to tensor
                processed_b64 = result["images"][0]
                return base64_to_tensor(processed_b64)
        
        # If processing fails, return original image
        return image_tensor
    except:
        # If any error, return original image
        return image_tensor

def base64_to_tensor(base64_str):
    img_data = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(img_data))
    img_array = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(img_array)[None,]

class ForgeControlNetStack:
    @classmethod
    def INPUT_TYPES(cls):
        # Get available models and preprocessors
        m_data = safe_get("http://127.0.0.1:7860/controlnet/model_list")
        cn_models = ["None"] + m_data.get("model_list", []) if (m_data and isinstance(m_data, dict)) else ["None"]
        mod_data = safe_get("http://127.0.0.1:7860/controlnet/module_list")
        cn_modules = ["none"] + mod_data.get("module_list", []) if (mod_data and isinstance(mod_data, dict)) else ["none"]
        
        # Build optional parameters for dynamic CN slots (cn_1, cn_2, etc.)
        optional = {}
        control_modes = ["Balanced", "My prompt is more important", "ControlNet is more important"]
        resize_modes = ["Just Resize", "Crop and Resize", "Resize and Fill"]
        
        for i in range(1, 21):  # Support up to 20 ControlNets
            p = f"cn_{i}"
            optional[f"{p}_image"] = ("IMAGE",)
            optional[f"{p}_model"] = (cn_models,)
            optional[f"{p}_preprocessor"] = (cn_modules,)
            optional[f"{p}_weight"] = ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05})
            optional[f"{p}_start"] = ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01})
            optional[f"{p}_end"] = ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01})
            optional[f"{p}_resolution"] = ("INT", {"default": 512, "min": 64, "max": 2048, "step": 64})
            optional[f"{p}_threshold_a"] = ("FLOAT", {"default": 100, "min": 0, "max": 255, "step": 1})
            optional[f"{p}_threshold_b"] = ("FLOAT", {"default": 200, "min": 0, "max": 255, "step": 1})
            optional[f"{p}_control_mode"] = (control_modes, {"default": "Balanced"})
            optional[f"{p}_resize_mode"] = (resize_modes, {"default": "Crop and Resize"})

        return {
            "required": {
                "forge_url": ("STRING", {"default": "http://127.0.0.1:7860"}),
                "enabled": ("BOOLEAN", {"default": True}),
            },
            "optional": optional
        }

    RETURN_TYPES = ("CN_STACK",) + ("IMAGE",) * 20
    RETURN_NAMES = ("cn_stack",) + tuple([f"cn_{i}_preview" for i in range(1, 21)])
    OUTPUT_NODE = False
    FUNCTION = "build"
    CATEGORY = "ForgeUI"

    def build(self, forge_url, enabled, **kwargs):
        if not enabled:
            return ([],) + (None,) * 20

        stack = []
        image_outputs = [None] * 20
        
        # Group parameters by CN index
        cn_units = {}
        for key, value in kwargs.items():
            if not key.startswith("cn_"):
                continue
            
            parts = key.split("_", 2)  # Split into ['cn', index, param]
            if len(parts) < 3:
                continue
                
            cn_index = parts[1]
            param = parts[2]
            
            if cn_index not in cn_units:
                cn_units[cn_index] = {}
            cn_units[cn_index][param] = value

        # Process each CN unit in order
        for index in sorted(cn_units.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            unit = cn_units[index]
            
            # Check if we have both image and model
            img = unit.get("image")
            model = unit.get("model", "None")
            preprocessor = unit.get("preprocessor", "none")
            
            if img is not None and model != "None":
                # Process image through ControlNet preprocessor
                processed_img = process_controlnet_image(
                    img,
                    preprocessor,
                    int(unit.get("resolution", 512)),
                    float(unit.get("threshold_a", 100)),
                    float(unit.get("threshold_b", 200)),
                    forge_url
                )
                
                stack.append({
                    "enabled": True,
                    "module": preprocessor,
                    "model": model,
                    "weight": float(unit.get("weight", 1.0)),
                    "image": tensor_to_base64(img),
                    "processor_res": int(unit.get("resolution", 512)),
                    "threshold_a": float(unit.get("threshold_a", 100)),
                    "threshold_b": float(unit.get("threshold_b", 200)),
                    "guidance_start": float(unit.get("start", 0.0)),
                    "guidance_end": float(unit.get("end", 1.0)),
                    "control_mode": unit.get("control_mode", "Balanced"),
                    "resize_mode": unit.get("resize_mode", "Crop and Resize"),
                })
                
                # Store the processed image for output
                try:
                    idx_int = int(index) - 1  # Convert to 0-based index (cn_1 -> 0, cn_2 -> 1, etc.)
                    if 0 <= idx_int < 20:
                        image_outputs[idx_int] = processed_img
                except (ValueError, TypeError):
                    pass
        
        return (stack,) + tuple(image_outputs)