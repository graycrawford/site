struct Uniforms {
  camera:vec4f,render:vec4f,viewport:vec4f,options:vec4f,orientation:vec4f,lighting:vec4f,transport:vec4f,section:vec4f,excitation:vec4f,transfer:vec4f,transferShape:vec4f,particles:vec4f,flow:vec4f,geometry:vec4f,material:vec4f
}
struct WaveTerm {
  coefficient:vec4f,basis:vec4f
}
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> radial:array<f32>;
@group(0) @binding(2) var<storage,read> angular:array<f32>;
@group(0) @binding(3) var<storage,read> terms:array<WaveTerm>;
@group(0) @binding(4) var<storage,read_write> dots:array<vec4f>;
@group(0) @binding(5) var<storage,read> rcdf:array<f32>;
@group(0) @binding(6) var<storage,read> acdf:array<f32>;
@group(0) @binding(7) var<storage,read_write> cells:array<atomic<u32>>;
@group(0) @binding(8) var densityCache:texture_3d<f32>;
@group(0) @binding(9) var shadows:texture_3d<f32>;
@group(0) @binding(10) var grains:texture_3d<f32>;
@group(0) @binding(11) var history:texture_2d<f32>;
@group(0) @binding(12) var surfaces:texture_2d<f32>;
@group(0) @binding(13) var sphereShadows:texture_2d<f32>;
@group(0) @binding(14) var linearSampler:sampler;
@group(0) @binding(16) var outputGrid:texture_storage_3d<r32float,write>;
@group(0) @binding(17) var<storage,read> sphereDots:array<vec4f>;
struct DotEdit { destination:vec4f, velocity:vec4f }
@group(0) @binding(18) var<storage,read_write> dotEdits:array<DotEdit>;
const PI=3.141592653589793;
fn rotate(p:vec3f,q:vec4f)->vec3f{
  return p+2*cross(q.xyz,cross(q.xyz,p)+q.w*p);
}
fn inverse(q:vec4f)->vec4f{
  return vec4f(-q.xyz,q.w);
}
fn tableR(row:i32,x:f32)->f32{
  let p=clamp(x,0,1)*8191;
  let i=min(i32(p),8190);
  return mix(radial[row*8192+i],radial[row*8192+i+1],p-f32(i));
}
fn tableA(row:i32,x:f32)->f32{
  let p=clamp(x,0,1)*4095;
  let i=min(i32(p),4094);
  return mix(angular[row*4096+i],angular[row*4096+i+1],p-f32(i));
}
fn atomWave(p:vec3f,time:f32)->vec2f{
  let r=length(p);
  let theta=acos(clamp(p.y/max(r,1e-8),-1,1));
  let phi=atan2(p.z,p.x);
  var sum=vec2f(0);
  for(var i=0;i<i32(u.viewport.w);i++){
    let t=terms[i];
    let nr=r/t.basis.z;
    if(nr>1){
      continue;
    }
    let ratio=1/t.basis.z;
    let v=tableR(i32(t.basis.x),sqrt(nr))*tableA(i32(t.basis.y),theta/PI)*t.basis.w*ratio*sqrt(ratio);
    let phase=t.coefficient.z*phi+t.coefficient.w*time;
    let e=vec2f(cos(phase),sin(phase));
    let c=t.coefficient.xy;
    sum+=v*vec2f(c.x*e.x-c.y*e.y,c.x*e.y+c.y*e.x);
  }
  return sum;
}
fn wave(p:vec3f)->vec2f{
  return atomWave(rotate(p,u.orientation)*u.section.z,u.camera.w)*pow(u.section.z,1.5);
}
fn phaseColor(a:f32)->vec3f{
  return clamp(0.5+0.5*cos(vec3f(a)+vec3f(0,-2.0943951,2.0943951)),vec3f(0),vec3f(1));
}
fn hash(p:vec2u,salt:u32)->f32{
  var n=p.x*1973u+p.y*9277u+salt*26699u+911u;
  n=(n^(n>>16u))*2246822519u;
  n=(n^(n>>13u))*3266489917u;
  n^=n>>16u;
  return f32(n&0x00ffffffu)/16777216;
}
fn planeNormal()->vec3f{
  if(u.section.x>1.5&&u.section.x<2.5){
    return rotate(vec3f(0,0,1),inverse(u.orientation));
  }
  return vec3f(0,0,1);
}
fn clipSegment(ro:vec3f,rd:vec3f,n:vec3f,limit:f32,range:vec2f)->vec2f{
  let a=dot(rd,n);
  let b=limit-dot(ro,n);
  if(abs(a)<1e-7){
    if(b<0){
      return vec2f(1,-1);
    }
    return range;
  }
  let t=b/a;
  if(a>0){
    return vec2f(range.x,min(range.y,t));
  }
  return vec2f(max(range.x,t),range.y);
}
fn clipSection(ro:vec3f,rd:vec3f,range:vec2f)->vec2f{
  if(u.section.x<0.5){
    return range;
  }
  let n=planeNormal();
  let d=mix(-1.0,1.0,u.render.w);
  if(u.section.x>2.5){
    let a=clipSegment(ro,rd,n,d+u.section.y*0.5,range);
    return clipSegment(ro,rd,-n,-d+u.section.y*0.5,a);
  }
  return clipSegment(ro,rd,n,d,range);
}
fn displayDensity(d:f32)->f32{
  if(u.transfer.x<0.5||d<=0){
    return d;
  }
  let volume=max(1e-12,u.section.z*u.section.z*u.section.z);
  let logD=log2(max(d/volume,1e-30))/log2(10.0);
  let lo=min(u.transfer.z,u.transfer.w);
  let hi=max(u.transfer.z,u.transfer.w);
  let w=min(max(0.01,u.transferShape.x),max(0.0001,(hi-lo)*0.5));
  let mask=smoothstep(lo,lo+w,logD)*(1-smoothstep(hi-w,hi,logD));
  let mapped=pow(10.0,clamp(u.transferShape.y+u.transfer.y*(logD-u.transferShape.y),-30,15));
  return min(60000,mapped*volume*mask);
}
// Explicit float32 trilinear sampling also runs without optional float32-filterable support.
fn sampleGrid(tex:texture_3d<f32>,uv:vec3f,edge:bool)->f32{
  let size=vec3i(textureDimensions(tex));
  let p=uv*vec3f(size)-0.5;
  let base=vec3i(floor(p));
  let f=fract(p);
  var value=0.0;
  for(var z=0;z<2;z++){
    for(var y=0;y<2;y++){
      for(var x=0;x<2;x++){
        let index=base+vec3i(x,y,z);
        let weight=mix(vec3f(1)-f,f,vec3f(f32(x),f32(y),f32(z)));
        if(edge||(all(index>=vec3i(0))&&all(index<size))){
          value+=textureLoad(tex,clamp(index,vec3i(0),size-1),0).r*weight.x*weight.y*weight.z;
        }
      }
    }
  }
  return value;
}
fn nearest(tex:texture_2d<f32>,uv:vec2f)->vec4f{
  let size=vec2i(textureDimensions(tex));
  return textureLoad(tex,clamp(vec2i(uv*vec2f(size)),vec2i(0),size-1),0);
}
fn lightDirection()->vec3f{
  let c=cos(u.lighting.x);
  return vec3f(cos(u.options.y)*c,sin(u.lighting.x),sin(u.options.y)*c);
}
fn lightRight(light:vec3f)->vec3f{
  var axis=vec3f(0,1,0);
  if(abs(light.y)>0.98){
    axis=vec3f(1,0,0);
  }
  return normalize(cross(axis,light));
}
fn lightCoordinates(p:vec3f,light:vec3f)->vec3f{
  let right=lightRight(light);
  return vec3f(dot(p,right),dot(p,cross(light,right)),dot(p,light));
}
fn sphereVisibility(p:vec3f)->f32{
  let lp=lightCoordinates(p,lightDirection());
  let uv=vec2f(lp.x,-lp.y)*0.5+0.5;
  var visible=0.0;
  let texel=1.0/f32(textureDimensions(sphereShadows).x);
  for(var y=0;y<2;y++){
    for(var x=0;x<2;x++){
      let depth=nearest(sphereShadows,uv+(vec2f(f32(x),f32(y))-0.5)*texel).w;
      if(depth<=0||3-lp.z<=depth+0.0015){
        visible+=0.25;
      }
    }
  }
  return visible;
}
@compute @workgroup_size(4,4,4) fn densityGrid(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(outputGrid);
  if(any(gid>=size)){
    return;
  }
  let atom=(vec3f(gid)+0.5)/vec3f(size)*2-1;
  let psi=wave(rotate(atom,inverse(u.orientation)));
  textureStore(outputGrid,gid,vec4f(displayDensity(dot(psi,psi))));
}
@compute @workgroup_size(4,4,4) fn shadowGrid(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(outputGrid);
  if(any(gid>=size)){
    return;
  }
  let atom=(vec3f(gid)+0.5)/vec3f(size)*2-1;
  let p=rotate(atom,inverse(u.orientation));
  let light=lightDirection();
  let b=dot(p,light);
  let d=b*b-dot(p,p)+1;
  var range=vec2f(0,min(u.transport.y,max(0.0,-b+sqrt(max(d,0.0)))));
  range=clipSection(p,light,range);
  var od=0.0;
  if(d>0&&range.y>range.x){
    let ns=clamp(i32(u.transport.x),2,64);
    let ds=(range.y-range.x)/f32(ns);
    for(var k=0;k<ns;k++){
      var t=0.5;
      if(u.material.z>0.5){
        t=mix(0.5,fract(hash(gid.xy,gid.z*67u+u32(k))+u.viewport.z*0.7548777),u.transport.z);
      }
      let q=rotate(p+light*(range.x+(f32(k)+t)*ds),u.orientation)*0.5+0.5;
      let fog=sampleGrid(densityCache,q,false)*u.render.y*u.particles.x;
      var grain=0.0;
      if(u.geometry.x<0.5&&u.particles.y>0){
        grain=sampleGrid(grains,q,false)*u.particles.y;
      }
      od+=(fog+grain)*ds;
    }
  }
  textureStore(outputGrid,gid,vec4f(od));
}
struct VertexOut {
  @builtin(position) position:vec4f,@location(0) uv:vec2f
}
@vertex fn fullscreen(@builtin(vertex_index) id:u32)->VertexOut{
  let p=vec2f(f32((id<<1u)&2u),f32(id&2u));
  return VertexOut(vec4f(p*2-1,0,1),vec2f(p.x,1-p.y));
}
struct SphereVertex {
  @builtin(position) position:vec4f,@location(0) @interpolate(flat) center:vec3f
}
fn screenProjection(p:vec3f)->vec2f{
  var s=p.xy*u.camera.z*2.8/(3.1-p.z);
  if(u.options.z>0.5){
    s=p.xy*u.camera.z*(2.8/3.1);
  }
  s-=vec2f(u.camera.x,0.16);
  s.x/=u.viewport.x/u.viewport.y;
  return s;
}
@vertex fn sphereVertex(@builtin(vertex_index) corner:u32,@builtin(instance_index) id:u32)->SphereVertex{
  let marker=sphereDots[id];
  let center=rotate(marker.xyz/u.section.z,inverse(u.orientation));
  let radius=0.003*u.particles.z;
  var lo=vec2f(1e6);
  var hi=vec2f(-1e6);
  for(var i=0u;i<8u;i++){
    let p=center+radius*(vec3f(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u))*2-1);
    var q=screenProjection(p);
    q.y=-q.y;
    if(u.geometry.y>0.5){
      q=lightCoordinates(p,lightDirection()).xy;
    }
    lo=min(lo,q);
    hi=max(hi,q);
  }
  let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  var xy=mix(lo,hi,corners[corner]);
  if(marker.w==0||hash(vec2u(id,73),0)>=u.particles.y){
    xy=vec2f(3);
  }
  return SphereVertex(vec4f(xy,0,1),center);
}
struct SphereHit {
  @location(0) data:vec4f,@builtin(frag_depth) depth:f32
}
@fragment fn sphereFragment(in:SphereVertex)->SphereHit{
  var screen=vec2f(in.position.x/u.viewport.x*2-1,1-in.position.y/u.viewport.y*2);
  var ro:vec3f;
  var rd:vec3f;
  if(u.geometry.y>0.5){
    let l=lightDirection();
    let r=lightRight(l);
    ro=r*screen.x+cross(l,r)*screen.y+l*3;
    rd=-l;
  }
  else{
    screen.y=-screen.y;
    screen.x*=u.viewport.x/u.viewport.y;
    screen+=vec2f(u.camera.x,0.16);
    ro=vec3f(0,0,3.1);
    rd=normalize(vec3f(screen/u.camera.z,-2.8));
    if(u.options.z>0.5){
      ro=vec3f(screen/u.camera.z*(3.1/2.8),3.1);
      rd=vec3f(0,0,-1);
    }
  }
  let radius=0.003*u.particles.z;
  let oc=ro-in.center;
  let b=dot(oc,rd);
  let closest=oc-rd*b;
  let disc=radius*radius-dot(closest,closest);
  if(disc<=0){
    discard;
  }
  let entry=-b-sqrt(disc);
  let bound=dot(ro,rd);
  let bd=bound*bound-dot(ro,ro)+1;
  if(bd<=0){
    discard;
  }
  let range=clipSection(ro,rd,vec2f(max(max(0.0,entry),-bound-sqrt(bd)),min(-b+sqrt(disc),-bound+sqrt(bd))));
  if(range.y<=range.x){
    discard;
  }
  let p=ro+rd*range.x;
  var normal=normalize(p-in.center);
  if(range.x>entry+1e-5){
    let axis=planeNormal();
    normal=select(axis,-axis,dot(axis,rd)>0);
  }
  return SphereHit(vec4f(normal,range.x),range.x/6);
}
fn cloudBounce(p:vec3f,normal:vec3f,beta:vec3f)->vec3f{
  if(u.geometry.w<=0||u.particles.x<=0||u.lighting.y<=0){
    return vec3f(0);
  }
  let tangent=lightRight(normal);
  let bitangent=cross(normal,tangent);
  let light=lightDirection();
  var result=vec3f(0);
  for(var i=0;i<4;i++){
    let angle=(f32(i)+0.5)*1.570796327;
    let direction=normalize(normal+cos(angle)*tangent+sin(angle)*bitangent);
    let b=dot(p,direction);
    let d=b*b-dot(p,p)+1;
    if(d<=0){
      continue;
    }
    let range=clipSection(p,direction,vec2f(0.002,min(0.45,-b+sqrt(d))));
    if(range.y<=range.x){
      continue;
    }
    let ds=(range.y-range.x)/3;
    let mu=dot(direction,light);
    let g=clamp(u.lighting.w,-0.95,0.95);
    var phase=0.75*(1+mu*mu);
    if(u.section.w<0.5){
      phase=(1-g*g)/pow(max(1+g*g-2*g*mu,0.001),1.5);
    }
    var transmission=vec3f(1);
    var radiance=vec3f(0);
    for(var j=0;j<3;j++){
      let sample=p+direction*(range.x+(f32(j)+0.5)*ds);
      let uv=rotate(sample,u.orientation)*0.5+0.5;
      let sigma=sampleGrid(densityCache,uv,false)*u.render.y*u.particles.x;
      let attenuation=exp(-sigma*ds*beta);
      let incident=exp(-sampleGrid(shadows,uv,false)*beta)*sphereVisibility(sample);
      radiance+=transmission*(1-attenuation)*incident*phase;
      transmission*=attenuation;
    }
    result+=radiance*0.25;
  }
  return result*u.lighting.y*u.geometry.w;
}
fn shadeVolume(in:VertexOut)->vec4f{
  var screen=in.uv*2-1;
  screen.x*=u.viewport.x/u.viewport.y;
  screen.x+=u.camera.x;
  screen.y+=0.16;
  var ro=vec3f(0,0,3.1);
  var rd=normalize(vec3f(screen/u.camera.z,-2.8));
  if(u.options.z>0.5){
    ro=vec3f(screen/u.camera.z*(3.1/2.8),3.1);
    rd=vec3f(0,0,-1);
  }
  let b=dot(ro,rd);
  let disc=b*b-dot(ro,ro)+1;
  var acc=vec3f(0);
  if(disc>0){
    var range=clipSection(ro,rd,vec2f(-b-sqrt(disc),-b+sqrt(disc)));
    if(range.y>range.x){
      var surface=vec4f(0);
      if(u.geometry.x>0.5&&u.geometry.z>0.5&&u.particles.y>0){
        surface=nearest(surfaces,in.uv);
      }
      let hit=surface.w>=range.x&&surface.w<=range.y&&surface.w>0;
      if(hit){
        range.y=surface.w;
      }
      var steps=clamp(i32(u.options.x),48,768);
      if(u.geometry.x<0.5&&u.particles.y>0){
        steps=max(steps,i32(ceil((range.y-range.x)*f32(textureDimensions(grains).x)/1.2)));
      }
      let dt=(range.y-range.x)/f32(steps);
      var jitter=0.5;
      if(u.material.z>0.5){
        jitter=fract(hash(vec2u(in.position.xy),0)+u.viewport.z*0.6180339);
      }
      var transmission=vec3f(1);
      let light=lightDirection();
      let mu=dot(rd,light);
      let g=clamp(u.lighting.w,-0.95,0.95);
      var phase=0.75*(1+mu*mu);
      if(u.section.w<0.5){
        phase=(1-g*g)/pow(max(1+g*g-2*g*mu,0.001),1.5);
      }
      let raw=vec3f(0.65,0.95,1.4);
      let axis=normalize(vec3f(1));
      let hue=raw*cos(u.material.x)+cross(axis,raw)*sin(u.material.x)+axis*dot(axis,raw)*(1-cos(u.material.x));
      let beta=mix(vec3f(1),max(hue,vec3f(0.1)),u.transport.w);
      for(var j=0;j<steps;j++){
        let p=ro+rd*(range.x+(f32(j)+jitter)*dt);
        let psi=wave(p);
        let density=displayDensity(dot(psi,psi));
        var grain=0.0;
        if(u.geometry.x<0.5&&u.particles.y>0){
          grain=sampleGrid(grains,rotate(p,u.orientation)*0.5+0.5,false)*u.particles.y;
        }
        let sigma=density*u.render.y*u.particles.x+grain;
        var color=vec3f(1);
        if(u.render.z<0.5){
          color=phaseColor(atan2(psi.y,psi.x)+u.material.x);
        }
        var extinction=vec3f(1);
        if(u.render.z>1.5&&sigma>0.00001){
          let od=sampleGrid(shadows,rotate(p,u.orientation)*0.5+0.5,true);
          let tint=mix(vec3f(1),phaseColor(atan2(psi.y,psi.x)+u.material.x),u.material.y);
          var visibility=1.0;
          if(u.geometry.x>0.5&&u.particles.y>0){
            visibility=sphereVisibility(p);
          }
          color=tint*(vec3f(u.lighting.z)+u.lighting.y*phase*exp(-od*beta)*visibility);
          extinction=beta;
        }
        let attenuation=exp(-sigma*dt*extinction);
        acc+=transmission*(1-attenuation)*color;
        transmission*=attenuation;
        if(max(transmission.x,max(transmission.y,transmission.z))<0.001){
          break;
        }
      }
      if(hit){
        let p=ro+rd*range.y;
        let psi=wave(p);
        let od=sampleGrid(shadows,rotate(p,u.orientation)*0.5+0.5,true);
        var tint=mix(vec3f(1),phaseColor(atan2(psi.y,psi.x)+u.material.x),u.material.y);
        if(u.render.z<0.5){
          tint=phaseColor(atan2(psi.y,psi.x)+u.material.x);
        }
        let visibility=sphereVisibility(p+surface.xyz*0.002);
        let reflected=tint*(vec3f(u.lighting.z)+u.lighting.y*max(0.0,dot(surface.xyz,light))*visibility*exp(-od*beta)+cloudBounce(p,surface.xyz,beta));
        acc+=transmission*reflected;
      }
    }
  }
  var old=vec3f(0);
  if(u.options.w>0){
    old=nearest(history,in.uv).rgb;
  }
  return vec4f(mix(acc,old,u.options.w),1);
}
@fragment fn volume(in:VertexOut)->@location(0) vec4f{
  return shadeVolume(in);
}
fn linearToSRGB(c:vec3f)->vec3f{
  return select(1.055*pow(c,vec3f(1.0/2.4))-0.055,12.92*c,c<=vec3f(0.0031308));
}
@fragment fn integratedPresent(in:VertexOut)->@location(0) vec4f{
  var c=textureSampleLevel(history,linearSampler,in.uv,0).rgb;
  if(u.geometry.x>0.5&&u.particles.y>0&&nearest(surfaces,in.uv).w>0){
    c=shadeVolume(in).rgb;
  }
  return vec4f(linearToSRGB(1-exp(-max(c,vec3f(0))*u.render.x)),1);
}
fn randomBits(state:ptr<function,u32>)->u32{
  *state^=*state<<13u;
  *state^=*state>>17u;
  *state^=*state<<5u;
  return *state;
}
fn randomUnit(state:ptr<function,u32>)->f32{
  return (f32(randomBits(state)>>8u)+0.5)/16777216;
}
fn inverseCDF(row:i32,value:f32,rad:bool)->f32{
  var count=4096;
  if(rad){
    count=8192;
  }
  var lo=0;
  var hi=count-1;
  while(hi-lo>1){
    let mid=(lo+hi)/2;
    var v=0.0;
    if(rad){
      v=rcdf[row*count+mid];
    }
    else{
      v=acdf[row*count+mid];
    }
    if(v<value){
      lo=mid;
    }
    else{
      hi=mid;
    }
  }
  var a=0.0;
  var b=0.0;
  if(rad){
    a=rcdf[row*count+lo];
    b=rcdf[row*count+hi];
  }
  else{
    a=acdf[row*count+lo];
    b=acdf[row*count+hi];
  }
  return (f32(lo)+clamp((value-a)/max(b-a,1e-20),0,1))/f32(count-1);
}
fn flowVelocity(p:vec3f,time:f32)->vec3f{
  let psi=atomWave(p,time);
  let rho=dot(psi,psi);
  if(rho<1e-28){
    return vec3f(0);
  }
  let h=0.003*(1+length(p)/20);
  var v=vec3f(0);
  for(var axis=0;axis<3;axis++){
    var offset=vec3f(0);
    offset[axis]=h;
    let d=(atomWave(p+offset,time)-atomWave(p-offset,time))/(2*h);
    v[axis]=(psi.x*d.y-psi.y*d.x)/rho;
  }
  return v;
}
fn seedDot(rng:ptr<function,u32>,time:f32)->vec4f{
  let count=i32(u.viewport.w);
  var total=0.0;
  for(var i=0;i<count;i++){
    total+=dot(terms[i].coefficient.xy,terms[i].coefficient.xy);
  }
  if(total<1e-20){
    return vec4f(0);
  }
  for(var attempt=0;attempt<192;attempt++){
    var choice=randomUnit(rng)*total;
    var selected=count-1;
    for(var i=0;i<count;i++){
      choice-=dot(terms[i].coefficient.xy,terms[i].coefficient.xy);
      if(choice<=0){
        selected=i;
        break;
      }
    }
    let t=terms[selected];
    let ur=inverseCDF(i32(t.basis.x),randomUnit(rng),true);
    let r=ur*ur*t.basis.z;
    let theta=inverseCDF(i32(t.basis.y),randomUnit(rng),false)*PI;
    let phi=randomUnit(rng)*2*PI;
    let p=r*vec3f(sin(theta)*cos(phi),cos(theta),sin(theta)*sin(phi));
    var q=0.0;
    for(var i=0;i<count;i++){
      let b=terms[i];
      let nr=r/b.basis.z;
      if(nr>1){
        continue;
      }
      let basis=tableR(i32(b.basis.x),sqrt(nr))*tableA(i32(b.basis.y),theta/PI)/pow(b.basis.z,1.5);
      q+=dot(b.coefficient.xy,b.coefficient.xy)*basis*basis;
    }
    let psi=atomWave(p,time);
    if(randomUnit(rng)*f32(count)*q<=dot(psi,psi)){
      return vec4f(p,1);
    }
  }
  return vec4f(0);
}
fn finite3(v:vec3f)->bool{
  return all(abs(v)<vec3f(3.402823e38));
}
@compute @workgroup_size(128) fn advanceDots(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;
  if(id>=u32(u.flow.w)){
    return;
  }
  var rng=((id+1u)*747796405u+u32(u.viewport.z+1)*2891336453u)|1u;
  var marker=dots[id];
  if(u.flow.z>1.5){
    // Reuse each sample's random sequence across mixture edits. Accepted
    // targets follow |psi|²; the connecting spring is display interpolation.
    if(u.flow.z<2.5){
      var editRng=((id+1u)*747796405u+2891336453u)|1u;
      dotEdits[id].destination=seedDot(&editRng,u.camera.w);
    }
    let destination=dotEdits[id].destination;
    if(destination.w==0||marker.w==0){
      dots[id]=destination;
      dotEdits[id].velocity=vec4f(0);
      return;
    }
    let dt=u.excitation.w;
    let offset=marker.xyz-destination.xyz;
    let c=dotEdits[id].velocity.xyz+20*offset;
    let decay=exp(-20*dt);
    dots[id]=vec4f(destination.xyz+(offset+c*dt)*decay,1);
    dotEdits[id].velocity=vec4f((dotEdits[id].velocity.xyz-20*c*dt)*decay,0);
    return;
  }
  if(u.flow.z>0.5||marker.w==0){
    if(u.flow.z>0.5){rng=((id+1u)*747796405u+2891336453u)|1u;}
    dots[id]=seedDot(&rng,u.camera.w);
    dotEdits[id].destination=dots[id];
    dotEdits[id].velocity=vec4f(0);
    return;
  }
  dotEdits[id].velocity=vec4f(0);
  let duration=max(0.0,u.flow.y*64);
  var elapsed=0.0;
  var h=duration;
  for(var step=0;step<128&&elapsed<duration;step++){
    h=min(h,duration-elapsed);
    let time=u.flow.x+elapsed/64;
    let v=flowVelocity(marker.xyz,time);
    let vm=flowVelocity(marker.xyz+0.5*h*v,time+h/128);
    let displacement=h*vm;
    let error=length(h*(vm-v));
    let tolerance=0.0001*(1+length(marker.xyz));
    if(!finite3(displacement)||error>tolerance||length(displacement)>0.08*(1+length(marker.xyz))){
      h*=0.5;
      if(h<1e-7){
        break;
      }
      continue;
    }
    marker=vec4f(marker.xyz+displacement,marker.w);
    elapsed+=h;
    if(error<tolerance*0.2){
      h*=2;
    }
  }
  if(elapsed<duration||!finite3(marker.xyz)){
    marker=seedDot(&rng,u.camera.w);
  }
  dots[id]=marker;
}
@compute @workgroup_size(128) fn depositDots(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;
  if(id>=u32(u.flow.w)||dots[id].w==0){
    return;
  }
  let size=i32(u.particles.w);
  let center=(dots[id].xyz/u.section.z*0.5+0.5)*f32(size)-0.5;
  let radius=(1.25+0.35*(clamp(u.particles.z,1,5)-1))*f32(size)/192;
  let reach=i32(ceil(radius));
  let base=vec3i(floor(center));
  for(var z=-reach;z<=reach;z++){
    for(var y=-reach;y<=reach;y++){
      for(var x=-reach;x<=reach;x++){
        let cell=base+vec3i(x,y,z);
        if(any(cell<vec3i(0))||any(cell>=vec3i(size))){
          continue;
        }
        let q=length(vec3f(cell)-center)/radius;
        if(q>=1){
          continue;
        }
        let weight=pow(1-q*q,3.0);
        let amount=u32(floor(weight*24*f32(size)/192/radius*2.2*1024+0.5));
        atomicAdd(&cells[(cell.z*size+cell.y)*size+cell.x],amount);
      }
    }
  }
}
@compute @workgroup_size(4,4,4) fn resolveDots(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(outputGrid).x;
  if(any(gid>=vec3u(size))){
    return;
  }
  textureStore(outputGrid,gid,vec4f(f32(atomicLoad(&cells[(gid.z*size+gid.y)*size+gid.x]))/1024));
}
