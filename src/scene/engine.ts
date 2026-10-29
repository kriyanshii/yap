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
/** Step used to walk a placement off an occupied spot. Fine enough to sit just clear of a stamp. */
const SPREAD=.02;
/** Half-width and half-height at scale 1, measured from the stamp drawings. A cat is drawn smaller than the others. */
const EXTENT:Record<ObjectType,[number,number]>={cat:[.099,.112],tree:[.112,.167],house:[.140,.183],sun:[.106,.106],cloud:[.135,.068]};
/** How far a thing "on" another may slide sideways and still read as on the roof. */
const ON_REACH=.15;
const halves=(type:ObjectType,scale:number):[number,number]=>{const [w,h]=EXTENT[type];return [w*scale,h*scale]};
const boxesOverlap=(x:number,y:number,hw:number,hh:number,o:SceneObject)=>{
  const [ow,oh]=halves(o.type,o.scale);
  return Math.abs(x-o.x)<hw+ow && Math.abs(y-o.y)<hh+oh;
};
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
   * Where a placement lands. A named spot or relation that is already occupied is walked, in small steps,
   * to the nearest free spot whose stamp box does not cover another stamp. "on" may cover its reference
   * (a cat stays on the roof) and only slides sideways within that roof. "above" stays above: if the box
   * would cover the reference it is lifted clear, then siblings slide sideways. `ignore` is the object being moved.
   */
  private position(pos:Pos|undefined,objects:SceneObject[],focus:string|null,added:Map<number,string>,type:ObjectType,scale:number,ignore:string[]=[]):[number,number]{
    const skip=new Set(ignore);let relation:Relation|undefined;let ref:SceneObject|undefined;let base:[number,number];
    if(!pos||typeof pos==='string')base=[...SPOT_COORDS[pos||'center']];
    else{
      ref=this.resolve(pos.ref,objects,focus,added);relation=pos.relation;
      if(relation==='on')skip.add(ref.id);
      const [dx,dy]=OFFSETS[relation];base=[ref.x+dx,ref.y+dy];
    }
    const [hw,hh]=halves(type,scale);
    if(ref&&relation&&relation!=='on'&&relation!=='near'&&boxesOverlap(base[0],base[1],hw,hh,ref)){
      const [rw,rh]=halves(ref.type,ref.scale);
      if(relation==='above')base=[base[0],ref.y-rh-hh];
      else if(relation==='below')base=[base[0],ref.y+rh+hh];
      else if(relation==='left_of')base=[ref.x-rw-hw,base[1]];
      else base=[ref.x+rw+hw,base[1]];
    }
    const allowed=(x:number,y:number)=>{
      if(!ref||!relation)return true;
      if(relation==='on')return Math.abs(x-ref.x)<=ON_REACH && y<=ref.y;
      if(relation==='above')return y<ref.y-.05;
      if(relation==='below')return y>ref.y+.05;
      if(relation==='left_of')return x<ref.x-.05;
      if(relation==='right_of')return x>ref.x+.05;
      return Math.abs(x-ref.x)<=.3 && Math.abs(y-ref.y)<=.25;
    };
    const area=(x:number,y:number)=>objects.reduce((sum,o)=>{
      if(skip.has(o.id))return sum;
      const [ow,oh]=halves(o.type,o.scale);
      const w=hw+ow-Math.abs(x-o.x),h=hh+oh-Math.abs(y-o.y);
      return w>0&&h>0?sum+w*h:sum;
    },0);
    const shifts=[0];
    for(let i=1;i<=46;i++)shifts.push(-i*SPREAD,i*SPREAD);
    const yShifts=relation==='on'?[0]:relation==='above'?shifts.filter(d=>d<=0):relation==='below'?shifts.filter(d=>d>=0):shifts;
    let best:[number,number]=[clamp(base[0],.08,.92),clamp(base[1],.08,.92)];
    let bestArea=Infinity,bestDist=Infinity;
    for(const dy of yShifts)for(const dx of shifts){
      const x=clamp(base[0]+dx,.08,.92),y=clamp(base[1]+dy,.08,.92);
      if(!allowed(x,y))continue;
      const overlap=area(x,y),dist=Math.abs(dx)+Math.abs(dy);
      if(overlap<bestArea-1e-9||(Math.abs(overlap-bestArea)<1e-9&&dist<bestDist)){best=[x,y];bestArea=overlap;bestDist=dist}
      if(overlap===0)return best;
    }
    return best;
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
            const scale=op.scale??1;
            const [x,y]=this.position(op.at,objects,focus,added,op.type,scale);
            const id=`${op.type}_${++counters[op.type]}`;
            objects.push({id,type:op.type,color:op.color||DEFAULTS[op.type],x,y,scale});
            added.set(i,id);focus=id;break;
          }
          case 'recolor':{const o=this.resolve(op.target,objects,focus,added);o.color=op.color;focus=o.id;break}
          case 'move':{const o=this.resolve(op.target,objects,focus,added);const [x,y]=this.position(op.to,objects,focus,added,o.type,o.scale,[o.id]);o.x=x;o.y=y;focus=o.id;break}
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
