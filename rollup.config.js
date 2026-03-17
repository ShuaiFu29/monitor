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
 */
export function createPackageConfig(packageDir, options = {}) {
  const input = path.resolve(packageDir, 'src/index.ts');
  const tsconfigPath = path.resolve(packageDir, 'tsconfig.json');
  const { external = [] } = options;

  const baseExternal = [
    '@monitor/types',
    '@monitor/utils',
    '@monitor/core',
    ...external,
  ];

  return [
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
          },
        }),
      ],
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
}

export { __dirname as rootDir };
