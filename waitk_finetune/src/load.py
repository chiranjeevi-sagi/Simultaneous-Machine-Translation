"""Load a (base or LoRA-fine-tuned) model for evaluation / inference.

Supports 4-bit quantization via bitsandbytes for low-VRAM GPUs (e.g. 6GB).
"""
from __future__ import annotations

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def load_model(base_name: str, adapter_path: str | None = None,
               dtype: str = "bfloat16", device: str | None = None,
               quantize_4bit: bool = False):
    """Load the model for inference.

    Args:
        quantize_4bit: If True, load in 4-bit via bitsandbytes (fits in ~3GB VRAM).
                       Requires: pip install bitsandbytes
    """
    device = device or ("cuda:0" if torch.cuda.is_available() else "cpu")
    torch_dtype = getattr(torch, dtype)

    tok_src = adapter_path or base_name
    tokenizer = AutoTokenizer.from_pretrained(tok_src)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"

    if quantize_4bit:
        from transformers import BitsAndBytesConfig

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch_dtype,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            base_name,
            quantization_config=bnb_config,
            device_map="auto",
            attn_implementation="eager",
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            base_name, dtype=torch_dtype, attn_implementation="eager"
        )

    if adapter_path:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter_path)
        if not quantize_4bit:
            model = model.merge_and_unload()   # fold LoRA into base for fast inference

    model.config.use_cache = True
    if not quantize_4bit:
        model.to(device)
    model.eval()
    return model, tokenizer


def load_from_ckpt(ckpt_path: str, device: str | None = None):
    """Load a model from a PyTorch Lightning ``.ckpt`` saved during training.

    The checkpoint stores the training cfg (LoRA config, base model name) in its
    hyper-parameters, so we can rebuild the LightningModule and restore weights,
    then fold LoRA into the base for fast inference.
    """
    import torch
    from transformers import AutoTokenizer

    from src.module import WaitKLightningModule

    device = device or ("cuda:0" if torch.cuda.is_available() else "cpu")

    # weights_only=False is required because the checkpoint's hyper-parameters
    # contain an OmegaConf DictConfig (not allow-listed by the safe unpickler).
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    cfg = ckpt["hyper_parameters"]["cfg"]

    tokenizer = AutoTokenizer.from_pretrained(cfg.model.name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"

    # Rebuild the LightningModule (base + LoRA) and restore the trained weights.
    module = WaitKLightningModule(cfg, tokenizer)
    module.load_state_dict(ckpt["state_dict"], strict=True)
    del ckpt

    model = module.model
    if hasattr(model, "merge_and_unload"):
        model = model.merge_and_unload()   # fold LoRA into base

    model.config.use_cache = True
    model.to(device).eval()
    return model, tokenizer
