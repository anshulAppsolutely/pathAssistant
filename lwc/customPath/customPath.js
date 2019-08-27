/**
 * Custom path assistant.
 * Standard path component doesn't support filtering stages without creating additional recordtypes.
 * This component wants to mimic the Case Support Process with Path
 *
 * Used only on RecordPages, this component is fully aware of it's context.
 */

import { LightningElement, api, wire, track } from 'lwc';
import { getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { updateRecord, getRecordUi } from 'lightning/uiRecordApi';
import { Step, getMasterRecordTypeId, getRecordTypeId } from 'c/utils';
import getStatusGuidance from '@salesforce/apex/EM_CaseLightningController.getStatusGuidance';
//labels
import labelGenericError from '@salesforce/label/c.labelGenericError';
import labelGuidanceForSuccess from '@salesforce/label/c.labelGuidanceForSuccess';
import labelStageUpdatedMessage from '@salesforce/label/c.labelStageUpdatedMessage';
import labelStageUpdatedButton from '@salesforce/label/c.labelStageUpdatedButton';

export default class CustomPath extends LightningElement {

    label = {
        labelGenericError,
        labelGuidanceForSuccess,
        labelStageUpdatedMessage,
        labelStageUpdatedButton
    };
    // current object api name
    @api objectApiName;

    // current record's id
    @api recordId;

    // picklist field's API name used to render the path assistant
    @api picklistField;

    // show/hide the update button
    @api hideUpdateButton;

    // show/hide a loading spinner
    @track spinner = false;

    // current object metadata info
    @track objectInfo;

    // current record
    @track record;

    // error message, when set will render the error panel
    @track errorMsg;

    // available picklist values for current record (based on record type)
    @track possibleSteps;

    // step selected by the user
    @track selectedStepValue;
    @track showGuidanceView;
    @track toggleBodyView;

    @api statusToRender1;
    @api statusToRender2;
    @api statusToRender3;
    @api statusToRender4;
    @api statusToRender5;
    @api statusToRender6;

    // label to give the last step
    @api lastStepLabel;

    // closed OK step value. When selected will render a green progress bar
    @api closedOk;

    // closed OK step value. When selected will render a green progress bar
    @api closedOk2;

    // current record's record type id
    _recordTypeId;

    @api pageLayout;

    @track guidanceMsg;

    @track toggleBodyViewDisabled;

    @track stageButtonAvailable;

    statusUpdateMessage;

    // true if current record reached a closed step
    get isClosed() {
        return this.isClosedOk || this.isClosedOk2;
    }

    // true if current record was closed OK
    get isClosedOk() {
        return this.currentStep.equals(this.closedOk);
    }

    // true if current record was closed OK
    get isClosedOk2() {
        return this.currentStep.equals(this.closedOk2);
    }


    /* ========== WIRED METHODS ========== */

    @wire(getRecordUi, {
        recordIds: '$recordId',
        layoutTypes: 'Full',
        modes: 'View'
    })
    wiredRecordUI({ error, data }) {
        if (error) {
            this.errorMsg = error.body.message;
        }

        if (data && data.records[this.recordId]) {
            // set the record
            this.record = data.records[this.recordId];

            // set the object info
            this.objectInfo = data.objectInfos[this.objectApiName];

            // set the current record type
            const rtId = getRecordTypeId(this.record);
            this._recordTypeId = rtId
                ? rtId
                : getMasterRecordTypeId(this.objectInfo);
        }
    }

    // load picklist values available for current record type
    @wire(getPicklistValuesByRecordType, {
        objectApiName: '$objectApiName',
        recordTypeId: '$_recordTypeId'
    })
    wiredPicklistValues({ error, data }) {
        if (!this._recordTypeId) {
            // invalid call
            return;
        }

        if (error) {
            this.errorMsg = error.body.message;
        }

        if (data) {
            if (data.picklistFieldValues[this.picklistField]) {
                // stores possible steps
                this.possibleSteps = data.picklistFieldValues[
                    this.picklistField
                    ].values.map((elem, idx) => {
                    return new Step(elem.value, elem.label, idx);
                });
            } else {
                this.errorMsg = `Impossible to load ${
                    this.picklistField
                    } values for record type ${this._recordTypeId}`;
            }
        }
    }

    /* ========== PRIVATE METHODS ========== */

    /**
     * Given a step returns the css class to apply in the rendered html element
     * @param {Object} step Step instance
     */
    _getStepElementCssClass(step) {
        let classText = 'slds-path__item';

        if (step.equals(this.closedOk) || step.equals(this.closedOk2)) {
            classText += ' slds-is-won slds-is-active';
        }

        if (step.equals(this.selectedStepValue)) {
            classText += ' slds-is-active';
        }

        if (step.equals(this.currentStep)) {
            classText += ' slds-is-current';

            if (!this.selectedStepValue) {
                // if user didn't select any step this is also the active one
                classText += ' slds-is-active';
            }
        } else if (step.isBefore(this.currentStep)) {
            classText += ' slds-is-complete';
        } else {
            // not yet completed or closedKo
            classText += ' slds-is-incomplete';
        }

        return classText;
    }

    /**
     * Reset the component state
     */
    _resetComponentState() {
        this.selectedStepValue = undefined;
    }

    /**
     * Update current record with the specified step.
     * @param {String} stepValue Step value to set on current record
     */
    _updateRecord(stepValue) {
        // format the record for update call
        let toUpdate = {
            fields: {
                Id: this.recordId
            }
        };

        // set new field value
        toUpdate.fields[this.picklistField] = stepValue;

        // starts spinner
        this.spinner = true;

        updateRecord(toUpdate)
            .then(() => {
                // close spinner
                this.spinner = false;
                this.statusUpdateMessage = this.label.labelStageUpdatedMessage;
                this.stageButtonAvailable = false;
            })
            .catch(error => {
                this.errorMsg = error.body.message;
                this.spinner = false;
            });

        // reset component state
        this._resetComponentState();
        this.getCaseStatusGuidance(stepValue);
    }

    /* ========== GETTER METHODS ========== */

    // returns current step of path assistant
    get currentStep() {
        for (let idx in this.possibleSteps) {
            if (
                this.possibleSteps[idx].equals(
                    this.record.fields[this.picklistField].value
                )
            ) {
                return this.possibleSteps[idx];
            }
        }
        // empty step
        return new Step();
    }

    // get progress bar steps
    get steps() {
        let closedOkElem;
        let closedOkElem1;
        // makes a copy of picklistValues. This is because during rendering phase we cannot alter the status of a tracked variable
        // const possibleSteps = JSON.parse(JSON.stringify(this.possibleSteps));

        let res = this.possibleSteps
            .filter(step => {

                //console.log(' vales >>'+step.value);

                // filters out closed steps
                if (step.equals(this.statusToRender1)) {
                    return true;
                }
                if (step.equals(this.statusToRender2)){
                    return true;
                }
                if (step.equals(this.statusToRender3)){
                    return true;
                }
                if (step.equals(this.statusToRender4)){
                    return true;
                }
                if (step.equals(this.statusToRender5)){
                    return true;
                }
                if (step.equals(this.statusToRender6)){
                    return true;
                }

                if (step.equals(this.closedOk)) {
                    closedOkElem = step;
                    return false;
                }

                if (step.equals(this.closedOk2)) {
                    closedOkElem1 = step;
                    return false;
                }

                return false;
            })
            .map(step => {
                // adds the classText property used to render correctly the element
                step.setClassText(this._getStepElementCssClass(step));
                return step;
            });

        let lastStep;

        if (this.isClosedOk) {
            lastStep = closedOkElem;
        }else if (this.isClosedOk2) {
            lastStep = closedOkElem1;
        } else {
            // record didn't reach a closed step
            // create a fake one that will allow users to pick either the closedOk or closedKo
            lastStep = new Step(
                'Closed',
                this.lastStepLabel,
                Infinity
            );
        }

        lastStep.setClassText(this._getStepElementCssClass(lastStep));

        res.push(lastStep);

        //console.log(' selected value >>'+this.selectedStepValue);

        //this is to get guidance first time when path is loaded
        if(this.selectedStepValue === undefined || this.selectedStepValue == null || this.selectedStepValue == '') {
            //console.log('in is loaded ' + this.currentStep.value+'  s>> selected step > '+this.selectedStepValue);
            let currentStepVal = this.currentStep.value;
            if(currentStepVal == this.statusToRender1 || currentStepVal == this.statusToRender2 || currentStepVal == this.statusToRender3 ||
                currentStepVal == this.statusToRender4 || currentStepVal == this.statusToRender5 || currentStepVal == this.closedOk || currentStepVal == this.closedOk2) {
                this.getCaseStatusGuidance(currentStepVal);
            }
        }

        return res;
    }

    // true when all required data is loaded
    get isLoaded() {
        const res = this.record && this.objectInfo && this.possibleSteps;
        return res;
    }

    // true if either spinner = true or component is not fully loaded
    get hasToShowSpinner() {
        return this.spinner || !this.isLoaded;
    }

    /**
     * Called when user clicks on a step
     * @param {Event} event Click event
     */
    handleStepSelected(event) {
        this.selectedStepValue = event.currentTarget.getAttribute('data-value');
        //get the guidance info
        this.getCaseStatusGuidance(this.selectedStepValue);

    }

    toggleBody(){
        this.toggleBodyView = !this.toggleBodyView;
        if(!this.toggleBodyView) this.showGuidanceView = false;
        this.statusUpdateMessage ='';
        this.getCaseStatusGuidance(this.selectedStepValue === undefined ? this.currentStep.value : this.selectedStepValue);

    }

    getCaseStatusGuidance(caseStatus){
        //console.log('selected val 11>>'+caseStatus+' page layout >>'+this.pageLayout+ 'toggel body >>'+this.toggleBodyView);
        getStatusGuidance({ caseStatus : caseStatus, pageLayout : this.pageLayout })
            .then(response => {
                if(response === undefined || response.gdMsg === undefined || response.gdMsg.length === 0){
                    //dont show anything
                    this.guidanceMsg='';
                    this.toggleBodyViewDisabled = true;
                    this.showGuidanceView = false;
                }else{
                    //console.log(' in here selected '+this.selectedStepValue);
                    //console.log(' in here toggleBodyView '+this.toggleBodyView);
                    this.error = false;
                    this.statusUpdateMessage = '';
                    this.stageButtonAvailable = false;
                    this.guidanceMsg = response.gdMsg;
                    this.toggleBodyViewDisabled = false;
                    if(this.selectedStepValue == null || this.selectedStepValue === undefined) {
                        this.toggleBodyView = true;
                        this.showGuidanceView = true;
                    }
                    if(this.toggleBodyView) this.showGuidanceView = true;
                    //console.log('butoon  >>>> '+JSON.parse(response.isButtonAvailable)+' current step >>'+this.currentStep.value);
                    let currentStep = this.currentStep.value;
                    let isButton = JSON.parse(response.isButtonAvailable);
                    if(isButton){
                        if(currentStep === caseStatus){
                            this.stageButtonAvailable = true;
                        }
                    }
                }
            })
            .catch(err =>{
                //console.error('error received in guidance flow >>'+err.body.message);
                //dont do anything;
            });
    }

    get toggleArrow(){
        //console.log('getting toggle arrow '+this.toggleBodyView);
        return this.toggleBodyView ? 'utility:chevronup' : 'utility:chevronright';
    }

    // returns next step
    get nextStep() {
        return this.possibleSteps[this.currentStep.index + 1];
    }

    /**
     * Called when user press the action button
     */
    handleUpdateButtonClick() {
        this._updateRecord(this.nextStep.value);
    }
}
