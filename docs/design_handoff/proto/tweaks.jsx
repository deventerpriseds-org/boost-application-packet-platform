// Tweaks panel for the Executive Engine prototype.
// Persona / Demo state / Visual / Feature flags.

function ProtoTweaks() {
  const {
    persona, setPersona,
    demoState, setDemoState,
    density, setDensity,
    dark, setDark,
    accent, setAccent,
    features, setFeatures,
    view, setView,
    toast,
  } = useApp();

  // Persist tweaks back to the file via __edit_mode_set_keys
  const persist = React.useCallback((key, value) => {
    try {
      window.parent.postMessage({ type:'__edit_mode_set_keys', edits: { [key]: value } }, '*');
    } catch (e) {}
  }, []);

  const setF = (k, v) => {
    setFeatures(prev => ({ ...prev, [k]: v }));
    persist('features', { ...features, [k]: v });
  };

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Persona" />
      <TweakRadio
        label="Role" value={persona}
        options={['CTO', 'VPE', 'VPP']}
        onChange={(v) => { setPersona(v); persist('persona', v); toast(`Persona → ${PERSONAS[v].label}`); }}
      />

      <TweakSection label="Demo state" />
      <TweakSelect
        label="Stage of journey" value={demoState}
        options={[
          { value:'fresh',   label:'Just started · day 3' },
          { value:'mid',     label:'Mid-pipeline · day 24' },
          { value:'closing', label:'Closing offer · day 42' },
        ]}
        onChange={(v) => { setDemoState(v); persist('demoState', v); toast(`Demo → ${DEMO_STATES[v].label}`); }}
      />

      <TweakSection label="View" />
      <TweakRadio
        label="Surface" value={view}
        options={['desktop', 'mobile']}
        onChange={(v) => { setView(v); persist('view', v); }}
      />

      <TweakSection label="Visual" />
      <TweakToggle
        label="Dark mode" value={dark}
        onChange={(v) => { setDark(v); persist('dark', v); }}
      />
      <TweakRadio
        label="Density" value={density}
        options={['comfortable', 'compact']}
        onChange={(v) => { setDensity(v); persist('density', v); }}
      />
      <TweakColor
        label="Accent" value={accent}
        options={['#3a5fc8', '#2d8a4e', '#8a2d7a', '#c87a3a', '#c83a3a']}
        onChange={(v) => { setAccent(v); persist('accent', v); }}
      />

      <TweakSection label="Feature flags" />
      <TweakToggle label="AI features"        value={features.ai}        onChange={(v) => setF('ai', v)} />
      <TweakToggle label="Swipe gestures"     value={features.swipe}     onChange={(v) => setF('swipe', v)} />
      <TweakToggle label="Interview recording"value={features.recording} onChange={(v) => setF('recording', v)} />
      <TweakToggle label="AI debriefs"        value={features.debrief}   onChange={(v) => setF('debrief', v)} />
      <TweakToggle label="Cadence engine"     value={features.cadence}   onChange={(v) => setF('cadence', v)} />
    </TweaksPanel>
  );
}

window.ProtoTweaks = ProtoTweaks;
