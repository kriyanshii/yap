// Scene engine v1 (from yap-scene-v1/src/engine.ts). The single copy: eval/ imports it from here, so the eval and the app cannot drift.
export const TYPES = ['cat', 'tree', 'house', 'sun', 'cloud'] as const;
export type ObjectType = typeof TYPES[number];
export const COLORS = ['red','orange','yellow','green','blue','purple','pink','brown','black','white','gray'] as const;
export type Color = typeof COLORS[number];
export const SPOTS = ['left','right','center','top','bottom','top-left','top-right','bottom-left','bottom-right'] as const;
export type Spot = typeof SPOTS[number];
export const RELATIONS = ['left_of','right_of','above','below','on','near'] as const;
export type Relation = typeof RELATIONS[number];
export type Ref = string | { type: ObjectType; nth?: number } | { added_in_op: number };
export type Pos = Spot | {relation: Relation; ref: Ref};
export type Op =
  | {op:'add'; type:ObjectType; color?:Color; at?:Pos; scale?:number}
  | {op:'recolor'; target:Ref; color:Color}
  | {op:'move'; target:Ref; to:Pos}
  | {op:'scale'; target:Ref; factor:number}
  | {op:'delete'; target:Ref}
  | {op:'undo'} | {op:'clear'};
export interface SceneObject {id:string;type:ObjectType;color:Color;x:number;y:number;scale:number}
export interface Snapshot {objects:SceneObject[];focus_id:string|null}
export interface State extends Snapshot { history: Snapshot[] }
export const DEFAULTS:Record<ObjectType,Color>={cat:'gray',tree:'green',house:'brown',sun:'yellow',cloud:'white'};
const SPOT_COORDS:Record<Spot,[number,number]>={left:[.2,.5],right:[.8,.5],center:[.5,.5],top:[.5,.2],bottom:[.5,.8],'top-left':[.2,.2],'top-right':[.8,.2],'bottom-left':[.2,.8],'bottom-right':[.8,.8]};
const OFFSETS:Record<Relation,[number,number]>={left_of:[-.2,0],right_of:[.2,0],above:[0,-.2],below:[0,.2],on:[0,-.14],near:[.13,.1]};
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
/** Minimum spacing between objects, and the step used to move a placement off an occupied spot. */
const SPREAD=.12;
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const isObj=(v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const keys=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>own(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const inSet=<T extends string>(v:unknown, arr:readonly T[]):v is T=>typeof v==='string' && (arr as readonly string[]).includes(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function parseRef(v:unknown):v is Ref {
  if(typeof v==='string') return /^[a-z]+_[1-9]\d*$/.test(v);
  if(!isObj(v)) return false;
  if(keys(v,['added_in_op']))return Number.isSafeInteger(v.added_in_op)&&Number(v.added_in_op)>=0;
  return keys(v,['type'],['nth'])&&inSet(v.type,TYPES)&&(!own(v,'nth')||(Number.isSafeInteger(v.nth)&&Number(v.nth)>=1));
}
function parsePos(v:unknown):v is Pos {
  if(inSet(v,SPOTS))return true;
  return isObj(v)&&keys(v,['relation','ref'])&&inSet(v.relation,RELATIONS)&&parseRef(v.ref);
}
function parseOp(v:unknown):v is Op {
  if(!isObj(v)||typeof v.op!=='string')return false;
  switch(v.op){
    case 'add':return keys(v,['op','type'],['color','at','scale'])&&inSet(v.type,TYPES)&&(!own(v,'color')||inSet(v.color,COLORS))&&(!own(v,'at')||parsePos(v.at))&&(!own(v,'scale')||(finite(v.scale)&&v.scale>=.3&&v.scale<=2));
    case 'recolor':return keys(v,['op','target','color'])&&parseRef(v.target)&&inSet(v.color,COLORS);
    case 'move':return keys(v,['op','target','to'])&&parseRef(v.target)&&parsePos(v.to);
    case 'scale':return keys(v,['op','target','factor'])&&parseRef(v.target)&&finite(v.factor)&&v.factor>0;
    case 'delete':return keys(v,['op','target'])&&parseRef(v.target);
    case 'undo':case 'clear':return keys(v,['op']);
    default:return false;
  }
}
export function validate(input:unknown): Op[] {
  if(!Array.isArray(input)||!input.every(parseOp))throw Error('Invalid operation schema');
  if(input.length>1&&input.some(op=>op.op==='undo'||op.op==='clear'))throw Error('undo/clear must be single-op batches');
  return input;
}
export function parseOutput(json:string):Op[]{return validate(JSON.parse(json) as unknown)}
export class SceneEngine {
  state:State={objects:[],focus_id:null,history:[]};
  private counters:Record<ObjectType,number>={cat:0,tree:0,house:0,sun:0,cloud:0};
  constructor(initial?:Snapshot){if(initial){this.state.objects=structuredClone(initial.objects);this.state.focus_id=initial.focus_id;for(const o of initial.objects){const n=Number(o.id.match(/_(\d+)$/)?.[1]||0);this.counters[o.type]=Math.max(this.counters[o.type],n)}}}
  snapshot():Snapshot{return {objects:structuredClone(this.state.objects),focus_id:this.state.focus_id}}
  private resolve(ref:Ref,objects:SceneObject[],focus:string|null,added:Map<number,string>):SceneObject {
    if(typeof ref==='string'){const o=objects.find(o=>o.id===ref);if(!o)throw Error(`Missing ID: ${ref}`);return o}
    if('added_in_op' in ref){const id=added.get(ref.added_in_op);const o=objects.find(o=>o.id===id);if(!o)throw Error('Invalid forward or non-add batch reference');return o}
    const matches=objects.filter(o=>o.type===ref.type);
    if(ref.nth!==undefined){const obj=matches[ref.nth-1];if(!obj)throw Error('nth reference unavailable');return obj}
    if(matches.length===1)return matches[0];
    const selected=matches.find(o=>o.id===focus);
    if(selected)return selected;
    throw Error('Ambiguous or missing type reference');
  }
  /**
   * Where a placement lands. If another object already sits there, the same 0.12 steps used for repeated spots
   * (left, right, further left, ...) are tried until the spot is free, so objects never stack invisibly.
   * Allowed to overlap: the relation's reference ("a cat on the house") and `ignore` (the object being moved).
   */
  private position(pos:Pos|undefined,objects:SceneObject[],focus:string|null,added:Map<number,string>,ignore:string[]=[]):[number,number]{
    const skip=new Set(ignore);let base:[number,number];
    if(!pos||typeof pos==='string')base=SPOT_COORDS[pos||'center'];
    else{const target=this.resolve(pos.ref,objects,focus,added);skip.add(target.id);const [dx,dy]=OFFSETS[pos.relation];base=[target.x+dx,target.y+dy]}
    const free=(x:number,y:number)=>objects.every(o=>skip.has(o.id)||Math.abs(o.x-x)>=SPREAD||Math.abs(o.y-y)>=SPREAD);
    for(let n=0;n<=8;n++){
      const shift=n===0?0:(n%2===1?-1:1)*Math.ceil(n/2)*SPREAD;
      const x=clamp(base[0]+shift,.08,.92),y=clamp(base[1],.08,.92);
      if(free(x,y))return [x,y];
    }
    return [clamp(base[0],.08,.92),clamp(base[1],.08,.92)];
  }
  /** Returns false on invalid batch, leaving all state unchanged. Empty [] is a successful no-op. */
  execute(candidate:unknown):boolean {
    let ops:Op[];
    try{ops=validate(candidate)}catch{return false}
    if(ops.length===0)return true;
    const before=this.snapshot();
    if(ops.length===1&&ops[0].op==='undo'){
      if(!this.state.history.length)return false;
      const last=this.state.history.pop()!;this.state.objects=structuredClone(last.objects);this.state.focus_id=last.focus_id;return true;
    }
    const objects=structuredClone(this.state.objects);
    let focus=this.state.focus_id;
    const added=new Map<number,string>();
    const counters={...this.counters};
    try {
      for(let i=0;i<ops.length;i++){
        const op=ops[i];
        switch(op.op){
          case 'add':{
            const [x,y]=this.position(op.at,objects,focus,added);
            const id=`${op.type}_${++counters[op.type]}`;
            objects.push({id,type:op.type,color:op.color||DEFAULTS[op.type],x,y,scale:op.scale??1});
            added.set(i,id);focus=id;break;
          }
          case 'recolor':{const o=this.resolve(op.target,objects,focus,added);o.color=op.color;focus=o.id;break}
          case 'move':{const o=this.resolve(op.target,objects,focus,added);const [x,y]=this.position(op.to,objects,focus,added,[o.id]);o.x=x;o.y=y;focus=o.id;break}
          case 'scale':{const o=this.resolve(op.target,objects,focus,added);o.scale=clamp(o.scale*op.factor,.3,2);focus=o.id;break}
          case 'delete':{const o=this.resolve(op.target,objects,focus,added);objects.splice(objects.findIndex(v=>v.id===o.id),1);focus=null;break}
          case 'clear':objects.length=0;focus=null;break;
          case 'undo':throw Error('Unexpected undo');
        }
      }
    }catch{return false}
    this.state.history.push(before);this.state.objects=objects;this.state.focus_id=focus;this.counters=counters;
    return true;
  }
}
