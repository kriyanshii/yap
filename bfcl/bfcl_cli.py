"""The `bfcl` CLI plus thinking-off variants of BFCL's built-in Qwen3 FC models.

BFCL's QwenFCHandler leaves Qwen3's assistant turn open, so the model thinks before answering. The "-nothink" entries
use the same handler, parser and scoring, but end the prompt with the empty "<think>\\n\\n</think>\\n\\n" block, which is
what Qwen3's own chat template emits when enable_thinking=False. The fine-tune is trained in this same no-think format.

    python bfcl_cli.py generate --model Qwen/Qwen3-1.7B-FC-nothink --test-category single_turn --backend vllm
"""

import dataclasses

from bfcl_eval.constants.model_config import MODEL_CONFIG_MAPPING
from bfcl_eval.model_handler.local_inference.qwen_fc import QwenFCHandler
from overrides import override  # BFCL's handlers require @override on overridden methods

NO_THINK = "<think>\n\n</think>\n\n"


class QwenFCNoThinkHandler(QwenFCHandler):
    @override
    def _format_prompt(self, messages, function):
        prompt = super()._format_prompt(messages, function)
        assert prompt.endswith("<|im_start|>assistant\n"), "unexpected Qwen prompt ending; BFCL changed"
        return prompt + NO_THINK


def register_no_think(base_models: list[str]) -> None:
    for base in base_models:
        cfg = MODEL_CONFIG_MAPPING[base]
        MODEL_CONFIG_MAPPING[f"{base}-nothink"] = dataclasses.replace(
            # no comma in the display name: BFCL writes its CSVs unquoted
            cfg, display_name=cfg.display_name.replace("(FC)", "(FC no-think)"), model_handler=QwenFCNoThinkHandler)


register_no_think(["Qwen/Qwen3-1.7B-FC", "Qwen/Qwen3-0.6B-FC"])

if __name__ == "__main__":
    from bfcl_eval.__main__ import cli  # imported after registration so the new names are valid choices

    cli()
