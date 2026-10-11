/**
 * Words people use in everyday writing. A target whose only name is one of these cannot be told
 * from the ordinary sentence ("click here", "start your trial"), so it is matched by its domain
 * or its longer name instead. Shared words of company names live in GENERIC_WORDS.
 */
const WORDS = `
about above account across action active actually address addresses after again against agent
agree ahead alert alike alive allow almost alone along already also always amazing among amount
another answer anyone anything appear apply approve archive archives around arrive article
asked assurance attach august aware away back balance base basic became because become before
begin behind being believe below benefit best better between beyond bill block board body book
booking born both bottom branch bridge bring broad build business button call came cancel card
care carry case cash catch cause center central certain chain change charge charter chase check
chewy choice choose circle claim class clay clean clear click close cloud code coffee collect
color come comfort coming common company complete confirm connect connection consider contact
contain content continue control convex copy corner correct cost could count country couple course
cover create credit current custom daily dark date dealer decide decision deep degree delay
delete deliver delta demand depend describe design detail develop device dice different direct
discord discount discover dish display doing done door double down draw dream drive during each
early earth easy effort either else email enable end enough ensure enter enterprise entire equal
error even event ever every exact example except exchange experience explore extra face fact fair
fall family farmers farther fast feature feel fetch few field fifty figure file fill final find
fine finish firm first fit five fix flat follow food force forget form forward found four frame
free fresh friend from front frontier full future gain game gap gather general get give glad
global goal going gold gone good grant graze great green grew group grow guard guess guide half
hand happen happy hard have head health healthcare hear heart heartbeat help here high hold home
hope hotels hour house however human hunter idea image important include indeed inform inside
instant instantly instead interest into invite issue item join just keep kayak keep kind knew
know label land large last late later launch lead learn least leave left legal length less let
letter level life light like limit line link list little live local lock lob long look loop lose
lost lot love low lumen mail main make manage many mark market marcus match matter maybe mean
meant measure meet member mention message meta might mind minute miss mobile model moment money
month more most mostly move much must name near need never new news next nice night noise none
normal north note nothing notice now number object ocean offer office often once only open
optimum option order origin other our out outside over own page paid pair paper part
particular partner party pass past path pay peacock people per perhaps period person persistent
phone pick piece place plain plan plant play please plunge point policy poor possible post power
precisely present press pretty previous price print privacy private problem process product
profile progressive promise protect provide public pull purchase pure push put quad quality
quick quite quorum raise range rate rather reach read ready real reason receive recent record
reduce refer region release remain remember remodeling remove repeat reply report request require
rest result retention return review right ring rise road rock room round rule run safe same save
say school score screen search seamless season second section secure see seem seen select self
sell send sense sent serve service set seven several shall share she shop short should show side
sign similar simple since single site six size skill slack small smart snap social some soon sort
sound source south southwest space speak special spectrum speed spend split spot square staples
stage stand standard start state station status stay step still stop store stories
story strata street strength stripe strong structure study stuff style subject subway succeed
such suggest summer supplier supply support sure swarm swoop system table take talk target team
tell ten term test text than thank that their them then there these they thing think third this
those though thought three through time title today together token told too took top total touch
toward town track trade train travel treat trial true trust try turn twitch two type under
understand unique united unity unless until update upon use user usually value various very view
visit voice wait walk want warm warmly watch water way week weight welcome well went were west
what when where whether which while white whole whose wide will window wish with within without
woman word work world would write wrong year yelp yes yet young your zoom ally affinity anthem bumble deluxe emerges enigma endgame grin lucid resonate windfall
modernize unmask staircase forewarn inflection terminus paramount vanguard
`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));
