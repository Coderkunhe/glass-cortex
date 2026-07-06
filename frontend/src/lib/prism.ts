/**
 * Prism.js 语法高亮初始化模块。
 *
 * 导入 Prism 核心 + 项目需要的语言语法定义 + line-numbers 插件。
 * 所有语言按需导入（tree-shakeable），不会全部打入 bundle。
 *
 * 使用方式：在组件 useEffect 中 import Prism from "@/lib/prism"，
 * 然后对 DOM 中的 <code class="language-xxx"> 调用 Prism.highlightElement()。
 *
 * @module lib/prism
 */

import Prism from "prismjs";

// ── 语言语法定义（按需导入，tree-shakeable）──
// 前端
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup"; // HTML / XML
import "prismjs/components/prism-markup-templating"; // PHP/Smarty 等依赖
// 后端/系统
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-objectivec";
// 函数式
import "prismjs/components/prism-haskell";
import "prismjs/components/prism-ocaml";
import "prismjs/components/prism-elixir";
import "prismjs/components/prism-erlang";
import "prismjs/components/prism-clojure";
import "prismjs/components/prism-fsharp";
// 脚本
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-lua";
// 数据/配置
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-toml";
// 统计/科学
import "prismjs/components/prism-r";
import "prismjs/components/prism-julia";
// 其他常见
import "prismjs/components/prism-wasm";
import "prismjs/components/prism-zig";
import "prismjs/components/prism-groovy";
import "prismjs/components/prism-vim";

// ── 插件 ──
import "prismjs/plugins/line-numbers/prism-line-numbers";

export default Prism;
