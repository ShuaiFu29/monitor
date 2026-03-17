import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import path from 'path';

/**
 * 为每个 package 创建 rollup 配置
 * @param {string} pkg - 包名 (如 'core', 'types')
 * @param {object} options - 额外选项
 */
export function createPackageConfig(pkg, options = {}) {
  const packageDir = path.resolve('packages', pkg);
  const input = path.resolve(packageDir, 'src/index.ts');
  const { external = [], globals = {} } = options;

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
          tsconfig: path.resolve(packageDir, 'tsconfig.json'),
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
