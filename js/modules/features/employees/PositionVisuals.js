// Some paths are adapted from Tabler Icons (MIT).
// See THIRD_PARTY_NOTICES.md for the required copyright and license notice.
const SVG_PATHS = {
    'hard-hat': '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M2.5 15h19v3h-19z"/><path d="M9 4v7M15 4v7"/>',
    hammer: '<path d="M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385"/><path d="M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0"/>',
    nails: '<path d="m5 3 16 16M3 5l4-4M19 21l2-2"/><path d="m19 3-16 16M17 1l4 4M3 19l2 2"/>',
    pickaxe: '<path d="M3 7c5-4 13-4 18 0"/><path d="m12 5-1 16"/><path d="m9 5 3 3 3-3"/>',
    shovel: '<path d="m14 3 3 3-9 9-3-3z"/><path d="m6 13-2 2a4 4 0 0 0 5 5l2-2"/><path d="m15 5 3-3 4 4-3 3"/>',
    wheelbarrow: '<path d="M3 5h3l2 10h9l4-7H7"/><path d="M8 15h10M10 15l-2 4M17 15l2 4"/><circle cx="7" cy="20" r="2"/>',
    trowel: '<path d="m4 19 9-3-6-6z"/><path d="m10 13 5-5"/><path d="m14 9 3-3a2 2 0 0 1 3 3l-3 3z"/>',
    drill: '<path d="M3 7h12v7H3z"/><path d="M15 9h5l2 2-2 2h-5"/><path d="m7 14 2 7h4l-1-7"/><path d="M5 10h3"/>',
    jackhammer: '<path d="M8 4h8v4H8zM10 8v8h4V8M9 11H6M15 11h3M12 16v6M10 19h4"/>',
    wrench: '<path d="M14 6a5 5 0 0 0-7 6L2 17l5 5 5-5a5 5 0 0 0 6-7l-3 3-4-4z"/>',
    screwdriver: '<path d="M9 3h6v8H9zM12 11v10M9 21h6"/><path d="M10 6h4"/>',
    pliers: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="m10 10 4 11M14 10 10 21M8 5l4-3 4 3"/>',
    saw: '<path d="M3 6h13l5 5-5 5H3z"/><path d="m5 16 2 3 2-3 2 3 2-3 2 3 2-3"/><circle cx="16" cy="11" r="1.5"/>',
    axe: '<path d="m13 3 7 3-2 7-7-3z"/><path d="m13 9-7 12"/><path d="m8 17 3 2"/>',
    crane: '<path d="M5 22V3h3v19M2 22h9M8 5h13M17 5v5M14 10h6l-1 4h-4z"/><path d="m8 5 7 5M5 10h3"/>',
    excavator: '<path d="M5 17h12l3 3H5a3 3 0 0 1 0-6h8"/><path d="M7 14V8h7l3 6"/><path d="m14 8 3-5 4 2-4 7"/><circle cx="7" cy="17" r="1"/><circle cx="15" cy="17" r="1"/>',
    tractor: '<path d="M4 15V9h8v6M8 9V5h6l3 5v5h3l2 3H4"/><circle cx="7" cy="18" r="3"/><circle cx="18" cy="18" r="2"/><path d="M12 7h3M2 18h2"/>',
    'cement-mixer': '<path d="m7 5 9-2 3 6-7 6-6-4z"/><path d="M9 14 6 20M15 13l3 7M4 20h16"/><circle cx="7" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M18 8h3v4"/>',
    truck: '<path d="M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5"/>',
    forklift: '<path d="M4 6h8v10H4zM12 10h4v6h-4M18 4v14h4"/><circle cx="7" cy="19" r="2"/><circle cx="16" cy="19" r="2"/>',
    bricks: '<path d="M3 5h8v5H3zM13 5h8v5h-8zM3 12h5v5H3zM10 12h8v5h-8zM20 12h1v5h-1zM5 19h8v3H5zM15 19h6v3h-6z"/>',
    ladder: '<path d="M7 2 5 22M17 2l2 20M7 6h10M6 10h12M6 14h12M5 18h14"/>',
    'tape-measure': '<path d="M4 6h11a5 5 0 0 1 5 5v7H4z"/><circle cx="10" cy="12" r="3"/><path d="M20 14h2v6h-8v-2"/>',
    toolbox: '<path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18"/><path d="M10 12h4v3h-4z"/>',
    'safety-vest': '<path d="M8 3h8l2 5 3 2-3 11H6L3 10l3-2z"/><path d="M9 3v5h6V3M6 13h12M12 8v13"/>',
    cone: '<path d="m9 3-5 16h16L15 3z"/><path d="M2 19h20v3H2zM7 12h10"/>',
    electrical: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
    plumbing: '<path d="M4 3v5a4 4 0 0 0 4 4h8a4 4 0 0 1 4 4v5"/><path d="M2 3h4M18 21h4"/><circle cx="12" cy="12" r="2"/>',
    'paint-roller': '<path d="M3 4h13v6H3zM16 7h3v5h-7v4M12 16v6"/><path d="M9 16h6"/>',
    welding: '<path d="M5 3h14l-1 12-6 6-6-6z"/><path d="M8 7h8v5H8zM3 8l-2-2M21 8l2-2M12 1V0"/>',
    ruler: '<path d="m4 17 13-13 4 4L8 21z"/><path d="m14 7 3 3M11 10l2 2M8 13l3 3"/>',
    blueprint: '<path d="M4 3h16v18H4z"/><path d="M8 7h8v4H8zM8 15h3M14 15h2M8 18h8"/>',
    crew: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21v-2a6 6 0 0 1 12 0v2M14 21v-1a5 5 0 0 1 8-4"/>',
    supervisor: '<path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5z"/><path d="m8 12 3 3 5-6"/>',
    building: '<path d="M4 22V5l8-3 8 3v17M2 22h20"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M11 22v-4h2v4"/>',
    box: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
    briefcase: '<path d="M3 7h18v13H3zM8 7V4h8v3M3 12h18"/><path d="M10 11h4v3h-4z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    badge: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
    'building-community': '<path d="M8 9l5 5v7h-5v-4m0 4h-5v-7l5 -5m1 1v-6a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v17h-8"/><path d="M13 7l0 .01M17 7l0 .01M17 11l0 .01M17 15l0 .01"/>',
    'building-skyscraper': '<path d="M3 21l18 0"/><path d="M5 21v-14l8 -4v18"/><path d="M19 21v-10l-6 -4"/><path d="M9 9l0 .01M9 12l0 .01M9 15l0 .01M9 18l0 .01"/>',
    karate: '<path d="M3 9l4.5 1l3 2.5M13 21v-8l3 -5.5M8 4.5l4 2l4 1l4 3.5l-2 3.5"/><path d="M15.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>',
    firetruck: '<path d="M3 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 18h8m4 0h2v-6a5 5 0 0 0 -5 -5h-1l1.5 5h4.5M12 18v-11h3M3 17l0 -5l9 0M3 9l18 -6M6 12l0 -4"/>',
    'wrecking-ball': '<path d="M17 13a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M2 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M11 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M13 19l-9 0M4 15l9 0M8 12v-5h2a3 3 0 0 1 3 3v5M5 15v-2a1 1 0 0 1 1 -1h7M19 11v-7l-6 7"/>',
    'user-hexagon': '<path d="M12 13a3 3 0 1 0 0 -6a3 3 0 0 0 0 6M6.201 18.744a4 4 0 0 1 3.799 -2.744h4a4 4 0 0 1 3.798 2.741"/><path d="M19.875 6.27c.7 .398 1.13 1.143 1.125 1.948v7.284c0 .809 -.443 1.555 -1.158 1.948l-6.75 4.27a2.269 2.269 0 0 1 -2.184 0l-6.75 -4.27a2.225 2.225 0 0 1 -1.158 -1.948v-7.285c0 -.809 .443 -1.554 1.158 -1.947l6.75 -3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98h-.033"/>',
    'hammer-drill': '<path d="M12 15v6M16 5h4M8 5h-4"/><path d="M15 11h-6a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1M14 11h-4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1 -1v-3"/>',
    'garden-cart': '<path d="M15 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M6 8v11a1 1 0 0 0 1.806 .591l3.694 -5.091v.055"/><path d="M6 8h15l-3.5 7l-7.1 -.747a4 4 0 0 1 -3.296 -2.493l-2.853 -7.13a1 1 0 0 0 -.928 -.63h-1.323"/>',
    'mood-crazy-happy': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M7 8.5l3 3M7 11.5l3 -3M14 8.5l3 3M14 11.5l3 -3M9.5 15a3.5 3.5 0 0 0 5 0"/>',
    pick: '<path d="M13 8l-9.383 9.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l9.407 -9.385"/><path d="M9 3h4.586a1 1 0 0 1 .707 .293l6.414 6.414a1 1 0 0 1 .293 .707v4.586a2 2 0 1 1 -4 0v-3l-5 -5h-3a2 2 0 1 1 0 -4"/>',
    plunger: '<path d="M12.71 14.12l7.81 -7.82a2 2 0 0 0 -2.82 -2.82l-7.82 7.81M3.71 13.22l.7 -.71a5 5 0 0 1 7.08 0a5 5 0 0 1 0 7.08l-.71 .7M3 12.5l8.5 8.5"/>',
    'battery-charging': '<path d="M16 7h1a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-2M8 7h-2a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h1M12 8l-2 4h3l-2 4"/>',
    'toilet-paper': '<path d="M3 10a3 7 0 1 0 6 0a3 7 0 1 0 -6 0M21 10c0 -3.866 -1.343 -7 -3 -7M6 3h12M21 10v10l-3 -1l-3 2l-3 -3l-3 2v-10M6 10h.01"/>',
    pipeline: '<path d="M3 4h8M4 4v5a6 6 0 0 0 6 6h3a1 1 0 0 1 1 1v4M10 4v4a1 1 0 0 0 1 1h3a6 6 0 0 1 6 6v5M13 20h8M12 9v6"/>',
    school: '<path d="M22 9l-10 -4l-10 4l10 4l10 -4v6M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"/>',
    paint: '<path d="M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -2M19 6h1a2 2 0 0 1 2 2a5 5 0 0 1 -5 5l-5 0v2M10 16a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -4"/>',
    'hand-love-you': '<path d="M11 11.5v-1a1.5 1.5 0 0 1 3 0v1.5M17 12v-6.5a1.5 1.5 0 0 1 3 0v10.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47M14 10.5a1.5 1.5 0 0 1 3 0v1.5M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5"/>',
    'hand-little-finger': '<path d="M8 13v-2.5a1.5 1.5 0 0 1 3 0v1.5M11 11.5v-1a1.5 1.5 0 0 1 3 0v1.5M17 12v-5.5a1.5 1.5 0 0 1 3 0v9.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47M14 10.5a1.5 1.5 0 0 1 3 0v1.5"/>',
    'hand-middle-finger': '<path d="M8 13v-2.5a1.5 1.5 0 0 1 3 0v1.5M14 10.5a1.5 1.5 0 0 1 3 0v1.5M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47M11 11.5v-8a1.5 1.5 0 1 1 3 0v8.5"/>',
    'brand-among-us': '<path d="M10.646 12.774c-1.939 .396 -4.467 .317 -6.234 -.601c-2.454 -1.263 -1.537 -4.66 1.423 -4.982c2.254 -.224 3.814 -.354 5.65 .214c.835 .256 1.93 .569 1.355 3.281c-.191 1.067 -1.07 1.904 -2.194 2.088M5.84 7.132c.083 -.564 .214 -1.12 .392 -1.661c.456 -.936 1.095 -2.068 3.985 -2.456a22.464 22.464 0 0 1 2.867 .08c1.776 .14 2.643 1.234 3.287 3.368c.339 1.157 .46 2.342 .629 3.537v11l-12.704 -.019c-.552 -2.386 -.262 -5.894 .204 -8.481M17 10c.991 .163 2.105 .383 3.069 .67c.255 .13 .52 .275 .534 .505c.264 3.434 .57 7.448 .278 9.825h-3.881"/>',
    cat: '<path d="M20 3v10a8 8 0 1 1 -16 0v-10l3.432 3.432a7.963 7.963 0 0 1 4.568 -1.432c1.769 0 3.403 .574 4.728 1.546l3.272 -3.546M2 16h5l-4 4M22 16h-5l4 4M11 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M9 11v.01M15 11v.01"/>',
    'fish-bone': '<path d="M16.69 7.44a6.973 6.973 0 0 0 -1.69 4.56a6.97 6.97 0 0 0 1.699 4.571c1.914 -.684 3.691 -2.183 5.301 -4.565c-1.613 -2.384 -3.394 -3.883 -5.312 -4.565M2 9.504a40.73 40.73 0 0 0 2.422 2.504a39.679 39.679 0 0 0 -2.422 2.498M18 11v.01M4.422 12h10.578M7 10v4M11 8v8"/>',
    paw: '<path d="M14.7 13.5c-1.1 -2 -1.441 -2.5 -2.7 -2.5c-1.259 0 -1.736 .755 -2.836 2.747c-.942 1.703 -2.846 1.845 -3.321 3.291c-.097 .265 -.145 .677 -.143 .962c0 1.176 .787 2 1.8 2c1.259 0 3 -1 4.5 -1s3.241 1 4.5 1c1.013 0 1.8 -.823 1.8 -2c0 -.285 -.049 -.697 -.146 -.962c-.475 -1.451 -2.512 -1.835 -3.454 -3.538M20.188 8.082a1.039 1.039 0 0 0 -.406 -.082h-.015c-.735 .012 -1.56 .75 -1.993 1.866c-.519 1.335 -.28 2.7 .538 3.052c.129 .055 .267 .082 .406 .082c.739 0 1.575 -.742 2.011 -1.866c.516 -1.335 .273 -2.7 -.54 -3.052l-.001 0M9.474 9c.055 0 .109 0 .163 -.011c.944 -.128 1.533 -1.346 1.32 -2.722c-.203 -1.297 -1.047 -2.267 -1.932 -2.267c-.055 0 -.109 0 -.163 .011c-.944 .128 -1.533 1.346 -1.32 2.722c.204 1.293 1.048 2.267 1.933 2.267M16.456 6.733c.214 -1.376 -.375 -2.594 -1.32 -2.722a1.164 1.164 0 0 0 -.162 -.011c-.885 0 -1.728 .97 -1.93 2.267c-.214 1.376 .375 2.594 1.32 2.722c.054 .007 .108 .011 .162 .011c.885 0 1.73 -.974 1.93 -2.267M5.69 12.918c.816 -.352 1.054 -1.719 .536 -3.052c-.436 -1.124 -1.271 -1.866 -2.009 -1.866c-.14 0 -.277 .027 -.407 .082c-.816 .352 -1.054 1.719 -.536 3.052c.436 1.124 1.271 1.866 2.009 1.866c.14 0 .277 -.027 .407 -.082"/>',
    geometry: '<path d="M7 21l4 -12m2 0l1.48 4.439m.949 2.847l1.571 4.714M10 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 12c1.526 2.955 4.588 5 8 5c3.41 0 6.473 -2.048 8 -5M12 5v-2"/>',
    wall: '<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12M4 8h16M20 12h-16M4 16h16M9 4v4M14 8v4M8 12v4M16 12v4M11 16v4"/>'
};

const UI_SVG_PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/>',
    calendar: '<path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16"/>',
    leader: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M18 4h3v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
};

export const POSITION_ICON_OPTIONS = [
    { value: 'hard-hat', label: 'Casco', category: 'heavy', keywords: 'seguridad construcción obra' },
    { value: 'hammer', label: 'Martillo', category: 'heavy', keywords: 'carpintería herramienta golpe' },
    { value: 'nails', label: 'Clavos', category: 'heavy', keywords: 'clavo fijación carpintería herramienta' },
    { value: 'pickaxe', label: 'Pico', category: 'heavy', keywords: 'excavación minería tierra' },
    { value: 'shovel', label: 'Pala', category: 'heavy', keywords: 'excavación tierra obra' },
    { value: 'wheelbarrow', label: 'Carretilla', category: 'heavy', keywords: 'acarreo carga material construcción' },
    { value: 'trowel', label: 'Palustre', category: 'heavy', keywords: 'albañilería cemento mortero llana cuchara' },
    { value: 'drill', label: 'Taladro', category: 'heavy', keywords: 'perforación herramienta' },
    { value: 'jackhammer', label: 'Martillo neumático', category: 'heavy', keywords: 'demolición concreto pavimento herramienta' },
    { value: 'wrench', label: 'Llave', category: 'heavy', keywords: 'mecánica reparación herramienta' },
    { value: 'screwdriver', label: 'Destornillador', category: 'heavy', keywords: 'tornillo montaje herramienta' },
    { value: 'pliers', label: 'Alicates', category: 'heavy', keywords: 'pinza corte cable herramienta' },
    { value: 'saw', label: 'Sierra', category: 'heavy', keywords: 'corte carpintería madera' },
    { value: 'axe', label: 'Hacha', category: 'heavy', keywords: 'corte madera herramienta' },
    { value: 'crane', label: 'Grúa', category: 'heavy', keywords: 'maquinaria carga construcción' },
    { value: 'excavator', label: 'Excavadora', category: 'heavy', keywords: 'maquinaria pesada tierra' },
    { value: 'tractor', label: 'Tractor', category: 'heavy', keywords: 'maquinaria pesada campo movimiento tierra' },
    { value: 'cement-mixer', label: 'Mezcladora', category: 'heavy', keywords: 'cemento hormigón concreto maquinaria' },
    { value: 'truck', label: 'Camión', category: 'heavy', keywords: 'transporte carga conductor' },
    { value: 'firetruck', label: 'Camión de bomberos', category: 'heavy', keywords: 'emergencia incendio rescate vehículo' },
    { value: 'wrecking-ball', label: 'Bola de demolición', category: 'heavy', keywords: 'demolición grúa maquinaria pesada' },
    { value: 'hammer-drill', label: 'Martillo perforador', category: 'heavy', keywords: 'taladro demolición concreto herramienta' },
    { value: 'garden-cart', label: 'Carro de carga', category: 'heavy', keywords: 'carretilla jardín acarreo material' },
    { value: 'pick', label: 'Pico de mano', category: 'heavy', keywords: 'minería excavación herramienta golpe' },
    { value: 'wall', label: 'Muro', category: 'heavy', keywords: 'pared ladrillos bloques mampostería construcción' },
    { value: 'forklift', label: 'Montacargas', category: 'heavy', keywords: 'almacén carga operador' },
    { value: 'bricks', label: 'Mampostería', category: 'heavy', keywords: 'albañil bloque ladrillo pared' },
    { value: 'ladder', label: 'Escalera', category: 'heavy', keywords: 'altura acceso construcción' },
    { value: 'tape-measure', label: 'Cinta métrica', category: 'heavy', keywords: 'medición metro herramienta' },
    { value: 'toolbox', label: 'Caja de herramientas', category: 'heavy', keywords: 'equipo reparación mantenimiento' },
    { value: 'safety-vest', label: 'Chaleco de seguridad', category: 'heavy', keywords: 'protección visibilidad obra seguridad' },
    { value: 'cone', label: 'Señalización', category: 'heavy', keywords: 'seguridad vial tránsito' },
    { value: 'electrical', label: 'Electricidad', category: 'trades', keywords: 'electricista voltaje energía' },
    { value: 'plumbing', label: 'Plomería', category: 'trades', keywords: 'tubería agua instalación' },
    { value: 'paint-roller', label: 'Pintura', category: 'trades', keywords: 'pintor rodillo acabado' },
    { value: 'welding', label: 'Soldadura', category: 'trades', keywords: 'soldador metal máscara' },
    { value: 'ruler', label: 'Medición', category: 'trades', keywords: 'regla medida terminación' },
    { value: 'blueprint', label: 'Planos', category: 'trades', keywords: 'arquitectura diseño técnico' },
    { value: 'plunger', label: 'Destapador', category: 'trades', keywords: 'plomería baño tubería desagüe' },
    { value: 'battery-charging', label: 'Batería', category: 'trades', keywords: 'electricidad carga energía mantenimiento' },
    { value: 'toilet-paper', label: 'Servicios sanitarios', category: 'trades', keywords: 'limpieza baño mantenimiento papel' },
    { value: 'pipeline', label: 'Tuberías', category: 'trades', keywords: 'plomería instalación conducto agua gas' },
    { value: 'paint', label: 'Rodillo de pintura', category: 'trades', keywords: 'pintor acabado decoración' },
    { value: 'geometry', label: 'Geometría', category: 'trades', keywords: 'medición compás técnico diseño' },
    { value: 'crew', label: 'Cuadrilla', category: 'management', keywords: 'equipo personal ayudante' },
    { value: 'supervisor', label: 'Supervisión', category: 'management', keywords: 'líder encargado capataz gerente' },
    { value: 'building', label: 'Edificación', category: 'management', keywords: 'obra edificio proyecto' },
    { value: 'box', label: 'Materiales', category: 'management', keywords: 'almacén inventario paquete' },
    { value: 'briefcase', label: 'Administración', category: 'management', keywords: 'oficina puesto trabajo' },
    { value: 'cog', label: 'Operación', category: 'management', keywords: 'máquina técnico proceso' },
    { value: 'badge', label: 'Especialidad', category: 'management', keywords: 'destacado experto estrella' },
    { value: 'building-community', label: 'Complejo de edificios', category: 'management', keywords: 'comunidad residencial proyecto construcción' },
    { value: 'building-skyscraper', label: 'Rascacielos', category: 'management', keywords: 'edificio torre obra proyecto' },
    { value: 'user-hexagon', label: 'Perfil técnico', category: 'management', keywords: 'persona empleado especialista identificación' },
    { value: 'school', label: 'Formación', category: 'management', keywords: 'escuela capacitación educación graduación' },
    { value: 'karate', label: 'Artes marciales', category: 'other', keywords: 'karate deporte instructor entrenamiento' },
    { value: 'mood-crazy-happy', label: 'Rostro alegre', category: 'other', keywords: 'emoción divertido feliz personaje' },
    { value: 'hand-love-you', label: 'Gesto te quiero', category: 'other', keywords: 'mano gesto amor señas' },
    { value: 'hand-little-finger', label: 'Gesto meñique', category: 'other', keywords: 'mano dedo promesa señas' },
    { value: 'hand-middle-finger', label: 'Gesto de mano', category: 'other', keywords: 'mano dedo símbolo señas' },
    { value: 'brand-among-us', label: 'Tripulante', category: 'other', keywords: 'among us personaje juego traje' },
    { value: 'cat', label: 'Gato', category: 'other', keywords: 'animal mascota felino' },
    { value: 'fish-bone', label: 'Espina de pescado', category: 'other', keywords: 'animal comida pez residuo' },
    { value: 'paw', label: 'Huella', category: 'other', keywords: 'animal mascota pata veterinaria' }
];

const POSITION_ICON_NAMES = new Set(POSITION_ICON_OPTIONS.map(option => option.value));
const LEGACY_ICON_MAP = {
    personnel: 'crew',
    settings: 'wrench',
    package: 'box',
    layers: 'bricks',
    zap: 'electrical',
    shield: 'supervisor',
    target: 'ruler',
    activity: 'cog',
    home: 'building',
    grid: 'blueprint',
    star: 'badge'
};

export function resolvePositionIcon(position = {}) {
    if (POSITION_ICON_NAMES.has(position.icon)) return position.icon;
    if (LEGACY_ICON_MAP[position.icon]) return LEGACY_ICON_MAP[position.icon];

    const name = String(position.name || '').toLowerCase();
    if (/albañil|mampost|ladrill|bloque/.test(name)) return 'bricks';
    if (/tractor/.test(name)) return 'tractor';
    if (/carretill/.test(name)) return 'wheelbarrow';
    if (/mezcl|hormig|concret/.test(name)) return 'cement-mixer';
    if (/demolici[oó]n|martillo neum[aá]tico/.test(name)) return 'jackhammer';
    if (/electr|volt|energ/.test(name)) return 'electrical';
    if (/carpint|madera/.test(name)) return 'saw';
    if (/pint/.test(name)) return 'paint-roller';
    if (/sold/.test(name)) return 'welding';
    if (/plom|tuber/.test(name)) return 'plumbing';
    if (/gerente|capataz|supervisor|encargado/.test(name)) return 'supervisor';
    if (/operador|mec[aá]nic|t[eé]cnic/.test(name)) return 'cog';
    if (/ayudante|auxiliar|asistente/.test(name)) return 'crew';
    if (/almac[eé]n|material/.test(name)) return 'box';
    return 'hard-hat';
}

export function resolveLeaderIcon(leader = {}) {
    if (POSITION_ICON_NAMES.has(leader.icon)) return leader.icon;
    if (LEGACY_ICON_MAP[leader.icon]) return LEGACY_ICON_MAP[leader.icon];
    return 'supervisor';
}

export function renderPositionIconSvg(icon, { size = 24, className = '' } = {}) {
    const resolved = POSITION_ICON_NAMES.has(icon) ? icon : 'hard-hat';
    const safeSize = Number.isFinite(Number(size)) ? Math.max(12, Math.min(64, Number(size))) : 24;
    const safeClass = String(className).replace(/[^a-z0-9_-]/gi, '');
    return `<svg class="position-svg-icon ${safeClass}" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG_PATHS[resolved]}</svg>`;
}

export function renderPositionUiSvg(icon, { size = 16, className = '' } = {}) {
    const resolved = UI_SVG_PATHS[icon] ? icon : 'search';
    const safeSize = Number.isFinite(Number(size)) ? Math.max(12, Math.min(40, Number(size))) : 16;
    const safeClass = String(className).replace(/[^a-z0-9_-]/gi, '');
    return `<svg class="position-ui-icon ${safeClass}" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_SVG_PATHS[resolved]}</svg>`;
}

export function safePositionColor(color, fallback = '#06b6d4') {
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : fallback;
}
