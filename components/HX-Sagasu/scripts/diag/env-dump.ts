// 直接观测: 打印进程初始状态，供两侧对比
console.log(JSON.stringify({
  cwd: process.cwd(),
  argv1: process.argv[1],
  execPath: process.execPath,
  nodeOptions: process.env['NODE_OPTIONS'] ?? null,
  npmConfig: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('npm_'))),
  envCount: Object.keys(process.env).length,
  envKeysSample: Object.keys(process.env).sort().slice(0, 20),
}, null, 1))
