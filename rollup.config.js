import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 为每个 package 创建 rollup 配置
 * @param {string} packageDir - 包目录的绝对路径
 * @param {object} options - 额外选项
 * @param {string[]} options.external - 额外的外部依赖
 * @param {string} options.umdName - UMD 全局变量名（留空则不构建 UMD）
 * @param {Record<string, string>} options.umdGlobals - UMD external 的全局变量映射
 */
export function createPackageConfig(packageDir, options = {}) {
  const input = path.resolve(packageDir, 'src/index.ts');
  const tsconfigPath = path.resolve(packageDir, 'tsconfig.json');
  const { external = [], umdName, umdGlobals = {} } = options;

  const baseExternal = [
    '@monitor/types',
    '@monitor/utils',
    '@monitor/core',
    ...external,
  ];

  const configs = [
    // ESM + CJS 打包
    {
      input,
      output: [
        {
          file: path.resolve(packageDir, 'dist/index.esm.js'),
          format: 'esm',
          sourcemap: true,
        },
        {
          file: path.resolve(packageDir, 'dist/index.cjs.js'),
          format: 'cjs',
          sourcemap: true,
        },
      ],
      external: baseExternal,
      plugins: [
        resolve(),
        commonjs(),
        typescript({
          tsconfig: tsconfigPath,
          declaration: false,
        }),
        terser({
          compress: {
            pure_getters: true,
            unsafe: true,
            passes: 2,
            // Tree-shaking 增强：移除仅在开发环境使用的代码
            global_defs: {
              __DEV__: false,
            },
          },
          mangle: {
            // 保留公共 API 名称
            reserved: ['Monitor', 'createMonitor'],
          },
          format: {
            // 移除注释以减小体积
            comments: false,
          },
        }),
      ],
      // Tree-shaking 配置
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
      },
    },
    // 类型声明文件
    {
      input,
      output: {
        file: path.resolve(packageDir, 'dist/index.d.ts'),
        format: 'esm',
      },
      external: baseExternal,
      plugins: [dts()],
    },
  ];

  // UMD 格式（浏览器直接引用 <script> 标签）
  if (umdName) {
    configs.push({
      input,
      output: {
        file: path.resolve(packageDir, 'dist/index.umd.js'),
        format: 'umd',
        name: umdName,
        sourcemap: true,
        globals: {
          '@monitor/types': 'MonitorTypes',
          '@monitor/utils': 'MonitorUtils',
          '@monitor/core': 'MonitorCore',
          ...umdGlobals,
        },
      },
      external: baseExternal,
      plugins: [
        resolve(),
        commonjs(),
        typescript({
          tsconfig: tsconfigPath,
          declaration: false,
        }),
        terser({
          compress: {
            pure_getters: true,
            unsafe: true,
            passes: 2,
          },
          format: {
            comments: false,
          },
        }),
      ],
    });
  }

  return configs;
}

export { __dirname as rootDir };
