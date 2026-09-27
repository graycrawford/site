struct Uniforms {
  camera:vec4f,render:vec4f,viewport:vec4f,options:vec4f,orientation:vec4f,lighting:vec4f,transport:vec4f,section:vec4f,excitation:vec4f,transfer:vec4f,transferShape:vec4f,particles:vec4f,flow:vec4f,geometry:vec4f,material:vec4f,scattering:vec4f
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
// Per-dot front fog, transmission and six-axis cloud light: written by markerFog, read when shading.
@group(0) @binding(19) var<storage,read_write> markerFog:array<vec4f>;
@group(0) @binding(20) var<storage,read> markerLight:array<vec4f>;
@group(0) @binding(21) var markerIDs:texture_2d<u32>;
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
fn scatterLight(depth:vec3f,mu:f32)->vec3f{
  let g=clamp(u.lighting.w,-0.95,0.95);
  var result=vec3f(0);
  for(var i=0;i<3;i++){
    let gi=g*select(select(0.25,0.55,i==1),1.0,i==0);
    var phase=0.75*(1+mu*mu);
    if(u.section.w<0.5){phase=(1-gi*gi)/pow(max(1+gi*gi-2*gi*mu,0.001),1.5);}
    let weight=select(u.scattering.x*select(0.30,0.55,i==1),1.0,i==0);
    result+=weight*phase*exp(-depth*select(select(0.12,0.35,i==1),1.0,i==0));
  }
  return result;
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
// The exponent is anchored at transferShape.y, the band center, so it changes contrast but not in-band brightness.
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
fn sampleGridLevel(tex:texture_3d<f32>,uv:vec3f,level:i32)->f32{
  let size=vec3i(textureDimensions(tex,level));
  let p=uv*vec3f(size)-0.5;
  let base=vec3i(floor(p));
  let f=fract(p);
  var value=0.0;
  for(var z=0;z<2;z++){
    for(var y=0;y<2;y++){
      for(var x=0;x<2;x++){
        let index=base+vec3i(x,y,z);
        let weight=mix(vec3f(1)-f,f,vec3f(f32(x),f32(y),f32(z)));
        if(all(index>=vec3i(0))&&all(index<size)){
          value+=textureLoad(tex,index,level).r*weight.x*weight.y*weight.z;
        }
      }
    }
  }
  return value;
}
fn sampleGridLod(tex:texture_3d<f32>,uv:vec3f,lod:f32)->f32{
  let l=clamp(lod,0.0,f32(textureNumLevels(tex)-1));
  let a=i32(floor(l));
  return mix(sampleGridLevel(tex,uv,a),sampleGridLevel(tex,uv,min(a+1,i32(textureNumLevels(tex))-1)),fract(l));
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
  return sphereVisibilityBias(p,0.0015);
}
// bias ignores occluders that close in front of p; markers pass their own diameter to skip self-shadowing.
fn sphereVisibilityBias(p:vec3f,bias:f32)->f32{
  let lp=lightCoordinates(p,lightDirection());
  let uv=vec2f(lp.x,-lp.y)*0.5+0.5;
  // Bilinearly weighted 2x2 comparisons, so visibility changes continuously as markers move.
  let size=f32(textureDimensions(sphereShadows).x);
  let texel=uv*size-0.5;
  let base=floor(texel);
  let f=texel-base;
  var lit=vec4f(0);
  for(var i=0;i<4;i++){
    let depth=nearest(sphereShadows,(base+vec2f(f32(i&1),f32(i>>1))+0.5)/size).w;
    if(depth<=0||3-lp.z<=depth+bias){
      lit[i]=1.0;
    }
  }
  return mix(mix(lit.x,lit.y,f.x),mix(lit.z,lit.w,f.x),f.y);
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
      // Shadow steps read grains averaged over about one step, so small grains block light by their
      // whole mass instead of being skipped between samples.
      var grain=0.0;
      if(u.geometry.x<0.5&&u.particles.y>0){
        grain=sampleGridLod(grains,q,log2(max(1.0,ds*f32(textureDimensions(grains).x)*0.5)))*u.scattering.z;
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
  @builtin(position) position:vec4f,@location(0) @interpolate(flat) center:vec3f,@location(1) @interpolate(flat) id:u32
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
  return SphereVertex(vec4f(xy,0,1),center,id);
}
struct SphereHit {
  @location(0) data:vec4f,@builtin(frag_depth) depth:f32
}
struct SurfaceHit {
  @location(0) data:vec4f,@location(1) id:u32,@builtin(frag_depth) depth:f32
}
// Analytic ray/sphere hit in camera or light view; w < 0 where the marker is missed or cut away.
fn sphereSurface(in:SphereVertex)->vec4f{
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
    return vec4f(-1);
  }
  let entry=-b-sqrt(disc);
  let bound=dot(ro,rd);
  let bd=bound*bound-dot(ro,ro)+1;
  if(bd<=0){
    return vec4f(-1);
  }
  let range=clipSection(ro,rd,vec2f(max(max(0.0,entry),-bound-sqrt(bd)),min(-b+sqrt(disc),-bound+sqrt(bd))));
  if(range.y<=range.x){
    return vec4f(-1);
  }
  let p=ro+rd*range.x;
  var normal=normalize(p-in.center);
  if(range.x>entry+1e-5){
    let axis=planeNormal();
    normal=select(axis,-axis,dot(axis,rd)>0);
  }
  return vec4f(normal,range.x);
}
@fragment fn sphereFragment(in:SphereVertex)->SphereHit{
  let data=sphereSurface(in);
  if(data.w<0){
    discard;
  }
  return SphereHit(data,data.w/6);
}
// Camera view also records which dot covers each pixel, so shading can reuse that dot's front fog.
@fragment fn surfaceFragment(in:SphereVertex)->SurfaceHit{
  let data=sphereSurface(in);
  if(data.w<0){
    discard;
  }
  return SurfaceHit(data,in.id,data.w/6);
}
// Cloud light scattered toward p from along one direction: three cached samples over a short path.
// Uses only the cloud's own smooth shadowing; thin sphere shadows would make the fill flicker.
fn cloudRadiance(p:vec3f,direction:vec3f,beta:vec3f)->vec3f{
  let b=dot(p,direction);
  let d=b*b-dot(p,p)+1;
  if(d<=0){
    return vec3f(0);
  }
  let range=clipSection(p,direction,vec2f(0.002,min(0.45,-b+sqrt(d))));
  if(range.y<=range.x){
    return vec3f(0);
  }
  let ds=(range.y-range.x)/3;
  let mu=dot(direction,lightDirection());
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
    let incident=exp(-sampleGrid(shadows,uv,false)*beta);
    radiance+=transmission*(1-attenuation)*incident*phase;
    transmission*=attenuation;
  }
  return radiance;
}
// Four cosine-weighted hemisphere directions around the normal.
fn cloudBounce(p:vec3f,normal:vec3f,beta:vec3f)->vec3f{
  if(u.geometry.w<=0||u.particles.x<=0||u.lighting.y<=0){
    return vec3f(0);
  }
  let tangent=lightRight(normal);
  let bitangent=cross(normal,tangent);
  var result=vec3f(0);
  for(var i=0;i<4;i++){
    let angle=(f32(i)+0.5)*1.570796327;
    result+=cloudRadiance(p,normalize(normal+cos(angle)*tangent+sin(angle)*bitangent),beta)*0.25;
  }
  return result*u.lighting.y*u.geometry.w;
}
// The same fill from a dot's six-axis light cube; a marker is small enough to share one cube.
fn cubeBounce(normal:vec3f,base:u32)->vec3f{
  let n2=normal*normal;
  let x=markerLight[base+select(1u,0u,normal.x>=0)].rgb;
  let y=markerLight[base+select(3u,2u,normal.y>=0)].rgb;
  let z=markerLight[base+select(5u,4u,normal.z>=0)].rgb;
  return (n2.x*x+n2.y*y+n2.z*z)*u.lighting.y*u.geometry.w;
}
struct Ray {
  ro:vec3f,rd:vec3f
}
fn cameraRay(uv:vec2f)->Ray{
  var screen=uv*2-1;
  screen.x*=u.viewport.x/u.viewport.y;
  screen.x+=u.camera.x;
  screen.y+=0.16;
  if(u.options.z>0.5){
    return Ray(vec3f(screen/u.camera.z*(3.1/2.8),3.1),vec3f(0,0,-1));
  }
  return Ray(vec3f(0,0,3.1),normalize(vec3f(screen/u.camera.z,-2.8)));
}
fn mediumBeta()->vec3f{
  var raw=pow(vec3f(535.0/615.0,1,535.0/465.0),vec3f(u.scattering.y));
  raw*=3/dot(raw,vec3f(1));
  let axis=normalize(vec3f(1));
  let hue=raw*cos(u.material.x)+cross(axis,raw)*sin(u.material.x)+axis*dot(axis,raw)*(1-cos(u.material.x));
  var spectrum=max(hue,vec3f(0.0001));
  spectrum*=3/dot(spectrum,vec3f(1));
  return mix(vec3f(1),spectrum,u.transport.w);
}
// Front-to-back visible fog over steps of dt from near; returns radiance and updates transmission.
fn marchFog(ro:vec3f,rd:vec3f,near:f32,dt:f32,steps:i32,jitter:f32,beta:vec3f,transmission:ptr<function,vec3f>)->vec3f{
  let mu=dot(rd,lightDirection());
  var acc=vec3f(0);
  for(var j=0;j<steps;j++){
    let p=ro+rd*(near+(f32(j)+jitter)*dt);
    let psi=wave(p);
    let density=displayDensity(dot(psi,psi));
    var grain=0.0;
    if(u.geometry.x<0.5&&u.particles.y>0){
      grain=sampleGrid(grains,rotate(p,u.orientation)*0.5+0.5,false)*u.scattering.z;
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
      color=tint*(vec3f(u.lighting.z)+u.lighting.y*scatterLight(od*beta,mu)*visibility);
      extinction=beta;
    }
    let attenuation=exp(-sigma*dt*extinction);
    acc+=*transmission*(1-attenuation)*color;
    *transmission*=attenuation;
    if(max((*transmission).x,max((*transmission).y,(*transmission).z))<0.001){
      break;
    }
  }
  return acc;
}
// Markers are lit through the cloud like the cloud is, with a wrapped (half-Lambert squared) falloff:
// no hard terminator, fully dark only directly away from the light. Plus sphere shadows, ambient and bounce.
fn shadeMarker(p:vec3f,normal:vec3f,beta:vec3f,bounce:vec3f)->vec3f{
  let psi=wave(p);
  let od=sampleGrid(shadows,rotate(p,u.orientation)*0.5+0.5,true);
  var tint=mix(vec3f(1),phaseColor(atan2(psi.y,psi.x)+u.material.x),u.material.y);
  if(u.render.z<0.5){
    tint=phaseColor(atan2(psi.y,psi.x)+u.material.x);
  }
  let visibility=sphereVisibilityBias(p,0.0015+0.006*u.particles.z);
  let wrap=0.5+0.5*dot(normal,lightDirection());
  return tint*(vec3f(u.lighting.z)+u.lighting.y*wrap*wrap*visibility*exp(-od*beta)+bounce);
}
fn shadeVolume(in:VertexOut)->vec4f{
  let ray=cameraRay(in.uv);
  let ro=ray.ro;
  let rd=ray.rd;
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
      var jitter=0.5;
      if(u.material.z>0.5){
        jitter=fract(hash(vec2u(in.position.xy),0)+u.viewport.z*0.6180339);
      }
      var transmission=vec3f(1);
      let beta=mediumBeta();
      acc=marchFog(ro,rd,range.x,(range.y-range.x)/f32(steps),steps,jitter,beta,&transmission);
      if(hit){
        let p=ro+rd*range.y;
        acc+=transmission*shadeMarker(p,surface.xyz,beta,cloudBounce(p,surface.xyz,beta));
      }
    }
  }
  var old=vec3f(0);
  if(u.options.w>0){
    old=nearest(history,in.uv).rgb;
  }
  return vec4f(mix(acc,old,u.options.w),1);
}
// Fog in front of each marker, integrated once per dot rather than once per covered pixel.
// Markers are a few pixels wide, so the veil in front of one is effectively uniform across it.
@compute @workgroup_size(64) fn markerFogPass(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;
  // Inactive and thinned-out dots are never drawn.
  if(id>=u32(u.flow.w)||sphereDots[id].w==0||hash(vec2u(id,73),0)>=u.particles.y){
    return;
  }
  let center=rotate(sphereDots[id].xyz/u.section.z,inverse(u.orientation));
  var ro=vec3f(0,0,3.1);
  var rd=normalize(center-ro);
  if(u.options.z>0.5){
    ro=vec3f(center.xy,3.1);
    rd=vec3f(0,0,-1);
  }
  let b=dot(ro,rd);
  let disc=b*b-dot(ro,ro)+1;
  var acc=vec3f(0);
  var transmission=vec3f(1);
  let beta=mediumBeta();
  if(disc>0){
    let range=clipSection(ro,rd,vec2f(-b-sqrt(disc),-b+sqrt(disc)));
    if(range.y>range.x){
      // Same step spacing as a full pixel ray across this chord, ending at the marker's front.
      // A fractional last step keeps the integral continuous as the dot moves in depth.
      let dt=(range.y-range.x)/f32(clamp(i32(u.options.x),48,768));
      let span=max(0.0,min(range.y,dot(center-ro,rd)-0.003*u.particles.z)-range.x);
      let whole=min(i32(span/dt),768);
      let rest=span-f32(whole)*dt;
      acc=marchFog(ro,rd,range.x,dt,whole,0.5,beta,&transmission);
      if(rest>1e-6){
        acc+=marchFog(ro,rd,range.x+f32(whole)*dt,rest,1,0.5,beta,&transmission);
      }
    }
  }
  markerFog[id*8u]=vec4f(acc,0);
  markerFog[id*8u+1u]=vec4f(transmission,0);
  let fill=u.geometry.w>0&&u.particles.x>0&&u.lighting.y>0;
  let axes=array<vec3f,6>(vec3f(1,0,0),vec3f(-1,0,0),vec3f(0,1,0),vec3f(0,-1,0),vec3f(0,0,1),vec3f(0,0,-1));
  for(var i=0u;i<6u;i++){
    var light=vec3f(0);
    if(fill){
      light=cloudRadiance(center+axes[i]*0.003*u.particles.z,axes[i],beta);
    }
    markerFog[id*8u+2u+i]=vec4f(light,0);
  }
}
@fragment fn volume(in:VertexOut)->@location(0) vec4f{
  return shadeVolume(in);
}
fn linearToSRGB(c:vec3f)->vec3f{
  return select(1.055*pow(c,vec3f(1.0/2.4))-0.055,12.92*c,c<=vec3f(0.0031308));
}
// Full-resolution markers: each covered pixel shades its surface once, behind its dot's front fog.
@fragment fn integratedPresent(in:VertexOut)->@location(0) vec4f{
  var c=textureSampleLevel(history,linearSampler,in.uv,0).rgb;
  let surface=nearest(surfaces,in.uv);
  if(u.geometry.x>0.5&&u.particles.y>0&&surface.w>0){
    let base=textureLoad(markerIDs,vec2u(in.position.xy),0).r*8u;
    let ray=cameraRay(in.uv);
    c=markerLight[base].rgb+markerLight[base+1u].rgb*shadeMarker(ray.ro+ray.rd*surface.w,surface.xyz,mediumBeta(),cubeBounce(surface.xyz,base+2u));
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
// Box-filtered grain level for shadow rays: each texel averages the 2x2x2 block below it.
@compute @workgroup_size(4,4,4) fn downsampleGrains(@builtin(global_invocation_id) gid:vec3u){
  let size=textureDimensions(outputGrid);
  if(any(gid>=size)){
    return;
  }
  let last=vec3i(textureDimensions(grains))-1;
  var sum=0.0;
  for(var z=0;z<2;z++){
    for(var y=0;y<2;y++){
      for(var x=0;x<2;x++){
        sum+=textureLoad(grains,min(vec3i(gid*2u)+vec3i(x,y,z),last),0).r;
      }
    }
  }
  textureStore(outputGrid,gid,vec4f(sum/8));
}
@compute @workgroup_size(128) fn depositDots(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;
  // The same stable thinning as spheres: particles.y is the fraction of dots shown.
  if(id>=u32(u.flow.w)||dots[id].w==0||hash(vec2u(id,73),0)>=u.particles.y){
    return;
  }
  let size=i32(u.particles.w);
  let center=(dots[id].xyz/u.section.z*0.5+0.5)*f32(size)-0.5;
  let size1=clamp(u.particles.z,0.5,5);
  // Below size 1 grains shrink linearly; the renderer raises the grid so they stay at least 1.25 cells wide.
  let radius=max(1.0,select(1.25*size1,1.25+0.35*(size1-1),size1>=1)*f32(size)/192);
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
