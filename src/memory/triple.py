"""三元组数据模型——主语-谓语-宾语 + 置信度 + 序列化/反序列化。"""

from __future__ import annotations

from dataclasses import dataclass

_SEPARATOR = " — "
_ARROW = " → "


@dataclass(frozen=True)
class Triple:
    """结构化事实三元组 (主体, 关系, 客体)。

    ADR-002: Fact 层从自由文本升级为三元组，支持实体消歧、冲突检测、信息丢失检测。
    content 属性输出人类可读格式，直接存入 facts.content，下游无需改动。
    """

    subject: str
    relation: str
    object: str

    @property
    def content(self) -> str:
        """人类可读表示，存入 MemoryStore facts.content。"""
        return f"{self.subject}{_SEPARATOR}{self.relation}{_ARROW}{self.object}"

    @property
    def predicate_key(self) -> tuple[str, str]:
        """(主体, 关系) 二元组，用于冲突检测。

        同一主体同一关系、不同客体 = 潜在冲突。
        """
        return (self.subject, self.relation)

    @classmethod
    def from_content(cls, content: str) -> Triple | None:
        """从存储格式反解析。无法解析（旧数据）返回 None。"""
        sep_pos = content.find(_SEPARATOR)
        if sep_pos == -1:
            return None
        arrow_pos = content.find(_ARROW, sep_pos + len(_SEPARATOR))
        if arrow_pos == -1:
            return None
        subject = content[:sep_pos]
        relation = content[sep_pos + len(_SEPARATOR) : arrow_pos]
        obj = content[arrow_pos + len(_ARROW) :]
        if not subject or not relation or not obj:
            return None
        return cls(subject=subject, relation=relation, object=obj)
