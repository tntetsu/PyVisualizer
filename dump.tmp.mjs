import { parser } from '@lezer/python';
const src = process.argv[2];
const tree = parser.parse(src);
let out = '';
tree.cursor().iterate(n => { let d=0,p=n.node.parent; while(p){d++;p=p.parent;} if (['(',')','[',']','{','}',',',':'].includes(n.name)) return; out += `${'  '.repeat(d)}${n.name}${n.type.isError?'(ERR)':''} ${JSON.stringify(src.slice(n.from,n.to)).slice(0,40)}\n`; });
console.log(out);
